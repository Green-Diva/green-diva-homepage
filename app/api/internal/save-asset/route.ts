// POST /api/internal/save-asset — internal-only persistence endpoint.
//
// HTTP_API skills with `download` configured produce base64 + content-type;
// they then call this endpoint via a second HTTP_API skill that does
//   { url: "/api/internal/save-asset",
//     method: "POST",
//     authEnv: "INTERNAL_SERVICE_TOKEN",
//     authScheme: "Header",
//     authHeader: "X-Internal-Token",
//     bodyTemplate: { relicSlug, kind, base64, contentType } }
// to persist the blob and learn its relative path. The relative path
// returned matches the format used in Relic.enhancedImagePath /
// Relic.modelPath columns ("/<slug>/derived/<filename>").
//
// Auth: this endpoint is called server-to-server inside the same Node
// process. Authentication is the X-Internal-Token header derived from
// SAFETY_SECRET (see lib/internal-token.ts) — there's no user session
// involved. CSRF is N/A because requests originate from server runtime,
// not the browser; middleware lets /api/internal/* through without the
// session cookie because path is not prefix-matched there. (If you ever
// expose this endpoint over the public internet, put a reverse proxy in
// front blocking external POSTs.)
//
// Side effects:
//   - Writes file to private/relics/<slug>/derived/<kind>-<ts>.<ext>
//   - Returns { savedPath: "/<slug>/derived/<filename>" }
// Does NOT touch DB — Relic-column writeback happens in the runner via
// `output._relicWriteback` (Phase 2.3 refactor of maybeWriteRelicAsset).

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { internalSaveAssetSchema } from "@/lib/validators";
import { verifyInternalServiceToken, INTERNAL_TOKEN_HEADER } from "@/lib/internal-token";
import { RELIC_STORAGE_ROOT, ensureStorageRoot, inferContentType } from "@/lib/relicStorage";
import { respondError, respondValidationError } from "@/lib/api-error";

// Map common content-types back to file extensions when admin omits ext.
// Falls back to ".bin" for unknown types so we never write extension-less
// files (some downstream code uses ext to choose decoders).
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

export async function POST(req: NextRequest) {
  const tokenHeader = req.headers.get(INTERNAL_TOKEN_HEADER);
  if (!verifyInternalServiceToken(tokenHeader)) {
    return respondError("AUTH_REQUIRED", "unauthorized", 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return respondError("INVALID_JSON", "invalid JSON body", 400);
  }

  const parsed = internalSaveAssetSchema.safeParse(body);
  if (!parsed.success) {
    return respondValidationError(
      parsed.error.flatten(),
      "invalid body: " +
        parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; "),
    );
  }

  const { relicSlug, kind, base64, contentType, ext: extOverride } = parsed.data;
  const ext = extOverride ?? extFromContentType(contentType);

  let buf: Buffer;
  try {
    buf = Buffer.from(base64, "base64");
  } catch (e) {
    return respondError(
      "BASE64_INVALID",
      `invalid base64: ${e instanceof Error ? e.message : "decode failed"}`,
      400,
    );
  }
  if (buf.byteLength === 0) {
    return respondError("BUFFER_EMPTY", "decoded buffer is empty", 400);
  }

  // private/relics/<slug>/derived/<kind>-<ts>.<ext>
  // ts is millisecond-precision; collisions vanishingly rare for the
  // single-process write rate we expect.
  const filename = `${kind}-${Date.now()}${ext}`;
  const derivedDir = path.join(RELIC_STORAGE_ROOT, relicSlug, "derived");
  const absPath = path.join(derivedDir, filename);

  // Defense in depth — schema regex already disallows slug traversal,
  // but verify the resolved path stays inside RELIC_STORAGE_ROOT.
  const root = path.resolve(RELIC_STORAGE_ROOT);
  if (!path.resolve(absPath).startsWith(root + path.sep)) {
    return respondError("PATH_TRAVERSAL_BLOCKED", "path traversal blocked", 400);
  }

  try {
    await ensureStorageRoot();
    await fs.mkdir(derivedDir, { recursive: true });
    await fs.writeFile(absPath, buf);
  } catch (e) {
    console.error("[api/internal/save-asset] write failed", e);
    return respondError("WRITE_FAILED", "write failed", 500);
  }

  // Return the relative path in the same format Relic.enhancedImagePath /
  // modelPath columns store. The runner's writeback hook (output._relicWriteback)
  // is what actually updates the Relic row — this endpoint is pure storage.
  const savedPath = `/${relicSlug}/derived/${filename}`;
  const finalContentType = contentType || inferContentType(absPath);
  // absPath is returned so downstream agent skills (e.g. vision LLM_PROMPT
  // with imagePathsField) can read the freshly-saved file without another
  // round-trip. Server-side only — never leak to public clients.
  return NextResponse.json({
    savedPath,
    absPath,
    bytes: buf.byteLength,
    contentType: finalContentType,
  });
}
