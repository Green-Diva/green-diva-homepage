// SSRF-defended external image fetcher. Used by the manual-add path of
// POST /api/relics/[id]/candidate when admin pastes an image URL instead
// of uploading a file.
//
// Defenses (in order):
//   1. Protocol whitelist  — only http(s).
//   2. DNS resolve         — refuse RFC1918 / loopback / link-local hosts
//                            (defeat redirect-to-internal attacks).
//   3. AbortController     — 10 s connection budget.
//   4. Content-Type allow  — image/jpeg|png|webp|gif only.
//   5. Magic-number sniff  — first 4 bytes match the declared extension.
//   6. Size cap            — 15 MB (matches existing candidate file cap).
//
// Caller persists the returned buffer to disk; this helper never touches
// FS. Keeps it pure for unit testability.

import "server-only";
import { promisify } from "node:util";
import dns from "node:dns";
import net from "node:net";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BYTES = 15 * 1024 * 1024;

const lookup = promisify(dns.lookup);

const ALLOWED_CONTENT_TYPES: Record<string, ".jpg" | ".png" | ".webp" | ".gif"> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export class FetchExternalImageError extends Error {
  constructor(
    public code:
      | "INVALID_URL"
      | "PROTOCOL_BLOCKED"
      | "PRIVATE_HOST_BLOCKED"
      | "DNS_FAILED"
      | "TIMEOUT"
      | "HTTP_ERROR"
      | "CONTENT_TYPE_INVALID"
      | "MAGIC_NUMBER_MISMATCH"
      | "TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "FetchExternalImageError";
  }
}

export type FetchedImage = {
  buffer: Buffer;
  contentType: string;
  ext: ".jpg" | ".png" | ".webp" | ".gif";
  bytes: number;
};

// Reject non-public IPs. We have to do the lookup ourselves because
// fetch() resolves DNS internally and won't tell us the resolved IP
// before connecting — by then a redirect to 127.0.0.1 already executed.
function isPrivateOrReservedIp(ip: string): boolean {
  // IPv4
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10) return true;                                   // 10.0.0.0/8
    if (a === 127) return true;                                  // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true;                     // 169.254.0.0/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true;            // 172.16.0.0/12
    if (a === 192 && b === 168) return true;                     // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true;           // 100.64.0.0/10 CGNAT
    if (a === 0) return true;                                    // 0.0.0.0/8
    if (a >= 224) return true;                                   // multicast / reserved
    return false;
  }
  // IPv6
  if (net.isIPv6(ip)) {
    const lc = ip.toLowerCase();
    if (lc === "::1") return true;                               // loopback
    if (lc.startsWith("fe80")) return true;                      // link-local
    if (lc.startsWith("fc") || lc.startsWith("fd")) return true; // ULA
    if (lc.startsWith("ff")) return true;                        // multicast
    if (lc === "::") return true;                                // unspecified
    return false;
  }
  return true; // unrecognised → block
}

export async function fetchExternalImage(
  rawUrl: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<FetchedImage> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new FetchExternalImageError("INVALID_URL", "URL is not parseable");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FetchExternalImageError(
      "PROTOCOL_BLOCKED",
      `protocol "${parsed.protocol}" not allowed (only http/https)`,
    );
  }

  // Defeat IP-literal SSRF (admin pastes http://127.0.0.1) and DNS-based
  // SSRF (hostname resolves to private IP). Resolve all addresses; reject
  // if ANY is private — A/AAAA records can mix and an attacker can use
  // multi-record DNS to win the race.
  const host = parsed.hostname;
  if (!host) {
    throw new FetchExternalImageError("INVALID_URL", "missing host");
  }
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch (e) {
    throw new FetchExternalImageError(
      "DNS_FAILED",
      `DNS resolution failed for ${host}: ${e instanceof Error ? e.message : "unknown"}`,
    );
  }
  for (const a of addresses) {
    if (isPrivateOrReservedIp(a.address)) {
      throw new FetchExternalImageError(
        "PRIVATE_HOST_BLOCKED",
        `host ${host} resolves to non-public address ${a.address}`,
      );
    }
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MAX_BYTES;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      method: "GET",
      signal: ac.signal,
      // Disable redirect-following so we can re-validate each hop. fetch's
      // default follows up to 20 redirects without re-checking the host.
      redirect: "manual",
      headers: { "User-Agent": "GreenDiva/1.0 (+admin-network-candidate)" },
    });
  } catch (e) {
    if (ac.signal.aborted) {
      throw new FetchExternalImageError(
        "TIMEOUT",
        `fetch timed out after ${timeoutMs}ms`,
      );
    }
    throw new FetchExternalImageError(
      "HTTP_ERROR",
      `fetch failed: ${e instanceof Error ? e.message : "unknown"}`,
    );
  } finally {
    clearTimeout(timer);
  }

  // Manual redirect handling: surface as error so admin can paste the
  // final URL themselves (also avoids wasted re-validation cycles).
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    throw new FetchExternalImageError(
      "HTTP_ERROR",
      `HTTP ${res.status} redirect to ${loc ?? "(unknown)"} — paste the final URL`,
    );
  }
  if (!res.ok) {
    throw new FetchExternalImageError(
      "HTTP_ERROR",
      `HTTP ${res.status} ${res.statusText}`,
    );
  }

  const contentTypeRaw = (res.headers.get("content-type") || "").toLowerCase();
  const contentType = contentTypeRaw.split(";")[0].trim();
  const ext = ALLOWED_CONTENT_TYPES[contentType];
  if (!ext) {
    throw new FetchExternalImageError(
      "CONTENT_TYPE_INVALID",
      `content-type "${contentType || "(missing)"}" not allowed`,
    );
  }

  // Stream-cap the body to avoid loading 1GB of nothing into memory.
  const reader = res.body?.getReader();
  if (!reader) {
    throw new FetchExternalImageError("HTTP_ERROR", "response has no body");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new FetchExternalImageError(
          "TOO_LARGE",
          `image exceeds ${maxBytes} bytes`,
        );
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof FetchExternalImageError) throw e;
    throw new FetchExternalImageError(
      "HTTP_ERROR",
      `stream read failed: ${e instanceof Error ? e.message : "unknown"}`,
    );
  }
  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));

  // Magic-number sniff: trust the bytes over the header.
  if (!magicMatches(buffer, ext)) {
    throw new FetchExternalImageError(
      "MAGIC_NUMBER_MISMATCH",
      `bytes don't match declared content-type ${contentType}`,
    );
  }

  return { buffer, contentType, ext, bytes: buffer.byteLength };
}

function magicMatches(buf: Buffer, ext: ".jpg" | ".png" | ".webp" | ".gif"): boolean {
  if (buf.byteLength < 12) return false;
  switch (ext) {
    case ".jpg":
      // FF D8 FF
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case ".png":
      // 89 50 4E 47 0D 0A 1A 0A
      return (
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a
      );
    case ".webp":
      // "RIFF" + 4 bytes size + "WEBP"
      return (
        buf[0] === 0x52 &&
        buf[1] === 0x49 &&
        buf[2] === 0x46 &&
        buf[3] === 0x46 &&
        buf[8] === 0x57 &&
        buf[9] === 0x45 &&
        buf[10] === 0x42 &&
        buf[11] === 0x50
      );
    case ".gif":
      // "GIF87a" or "GIF89a"
      return (
        buf[0] === 0x47 &&
        buf[1] === 0x49 &&
        buf[2] === 0x46 &&
        buf[3] === 0x38 &&
        (buf[4] === 0x37 || buf[4] === 0x39) &&
        buf[5] === 0x61
      );
  }
}
