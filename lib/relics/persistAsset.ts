// Persistence helper for relic-derived binary assets.
//
// Replaces the retired /api/internal/save-asset HTTP endpoint. The backbone
// `persist` primitive node calls persistRelicAsset() in-process — no HTTP
// round trip, no HMAC token, no middleware exemption.
//
// Writes to private/relics/<slug>/derived/<kind>-<ts>.<ext>. The returned
// `savedPath` is the same format Relic.enhancedImagePath / Relic.modelPath /
// candidate paths use; `absPath` is exposed so downstream LLM_PROMPT vision
// skills (imagePathsField) can read the freshly-saved file without another
// round-trip — server-side only.

import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { RELIC_STORAGE_ROOT, ensureStorageRoot, inferContentType } from "@/lib/relicStorage";

// Accepts both real Relic slugs ("vault-001-abc") and draft workspace
// slugs ("_drafts/<cuid>"). The slash is the only special char allowed,
// and only as the prefix separator.
const RELIC_SLUG_RE = /^(_drafts\/)?[a-zA-Z0-9_-]{1,80}$/;
const KIND_RE = /^[a-z0-9-]{1,32}$/;
const EXT_RE = /^\.[a-z0-9]{1,8}$/;

export const persistAssetInputSchema = z.object({
  relicSlug: z.string().regex(RELIC_SLUG_RE, "relicSlug must match [a-zA-Z0-9_-]{1,80}"),
  kind: z.string().regex(KIND_RE, 'kind must match [a-z0-9-]{1,32} (e.g. "enhanced", "model")'),
  base64: z.string().min(1).max(120_000_000),
  contentType: z.string().max(120).optional(),
  ext: z.string().regex(EXT_RE, 'ext must look like ".png" / ".glb"').optional(),
});

export type PersistAssetInput = z.infer<typeof persistAssetInputSchema>;

export type PersistAssetResult = {
  savedPath: string;
  absPath: string;
  bytes: number;
  contentType: string;
};

export class PersistAssetError extends Error {
  code: "INPUT_INVALID" | "BASE64_INVALID" | "BUFFER_EMPTY" | "PATH_TRAVERSAL_BLOCKED" | "WRITE_FAILED";
  constructor(
    code: PersistAssetError["code"],
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "PersistAssetError";
  }
}

function extFromContentType(ct: string | undefined | null): string {
  if (!ct) return ".bin";
  const t = ct.toLowerCase().split(";")[0].trim();
  switch (t) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "model/gltf-binary":
      return ".glb";
    case "model/gltf+json":
      return ".gltf";
    case "application/octet-stream":
      return ".bin";
    default:
      return ".bin";
  }
}

export async function persistRelicAsset(rawInput: unknown): Promise<PersistAssetResult> {
  const parsed = persistAssetInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new PersistAssetError("INPUT_INVALID", `invalid persist input: ${issues}`);
  }
  const { relicSlug, kind, base64, contentType, ext: extOverride } = parsed.data;
  const ext = extOverride ?? extFromContentType(contentType);

  let buf: Buffer;
  try {
    buf = Buffer.from(base64, "base64");
  } catch (e) {
    throw new PersistAssetError(
      "BASE64_INVALID",
      `invalid base64: ${e instanceof Error ? e.message : "decode failed"}`,
    );
  }
  if (buf.byteLength === 0) {
    throw new PersistAssetError("BUFFER_EMPTY", "decoded buffer is empty");
  }

  const filename = `${kind}-${Date.now()}${ext}`;
  const derivedDir = path.join(RELIC_STORAGE_ROOT, relicSlug, "derived");
  const absPath = path.join(derivedDir, filename);

  const root = path.resolve(RELIC_STORAGE_ROOT);
  if (!path.resolve(absPath).startsWith(root + path.sep)) {
    throw new PersistAssetError("PATH_TRAVERSAL_BLOCKED", "path traversal blocked");
  }

  try {
    await ensureStorageRoot();
    await fs.mkdir(derivedDir, { recursive: true });
    await fs.writeFile(absPath, buf);
  } catch (e) {
    throw new PersistAssetError(
      "WRITE_FAILED",
      `write failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return {
    savedPath: `/${relicSlug}/derived/${filename}`,
    absPath,
    bytes: buf.byteLength,
    contentType: contentType || inferContentType(absPath),
  };
}
