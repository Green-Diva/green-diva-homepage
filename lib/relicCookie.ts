import "server-only";
import { createHmac } from "node:crypto";

export const RELIC_UNLOCK_COOKIE = "gd_relic_unlocks";
const TTL_MS = 1000 * 60 * 60 * 24; // 24h
const MAX_ENTRIES = 64;

function getSecret(): string {
  const s = process.env.SAFETY_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SAFETY_SECRET missing or too short (>=16 chars)");
  }
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Entry = { id: string; exp: number };

export function parseUnlockCookie(raw: string | undefined): Set<string> {
  const ids = new Set<string>();
  if (!raw) return ids;
  const now = Date.now();
  for (const piece of raw.split(",")) {
    const [body, sig] = piece.split(".");
    if (!body || !sig) continue;
    if (!timingSafeEqual(sig, sign(body))) continue;
    try {
      const json = Buffer.from(body, "base64url").toString("utf8");
      const entry = JSON.parse(json) as Entry;
      if (entry.exp > now) ids.add(entry.id);
    } catch {
      continue;
    }
  }
  return ids;
}

export function serializeUnlockCookie(ids: Iterable<string>, ttlMs: number = TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const out: string[] = [];
  let count = 0;
  for (const id of ids) {
    if (count >= MAX_ENTRIES) break;
    const body = Buffer.from(JSON.stringify({ id, exp })).toString("base64url");
    out.push(`${body}.${sign(body)}`);
    count += 1;
  }
  return out.join(",");
}

export function unlockCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(TTL_MS / 1000),
  };
}
