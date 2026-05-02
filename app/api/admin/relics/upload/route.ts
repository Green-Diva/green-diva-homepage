import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import { AuthError, requireAdmin } from "@/lib/auth";
import { RELIC_STORAGE_ROOT, ensureStorageRoot } from "@/lib/relicStorage";

const MAX_BYTES = 50 * 1024 * 1024; // 50MB for model/photo
const MAX_BYTES_ARCHIVE = 200 * 1024 * 1024; // 200MB for archive
const ALLOWED_MIMES = new Set([
  "model/gltf-binary",
  "model/gltf+json",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);
const ALLOWED_EXTS = new Set([".glb", ".gltf", ".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const ARCHIVE_MIMES = new Set(["application/zip", "application/x-zip-compressed", "application/octet-stream"]);
const SAFE_SLUG = /^[a-z0-9-]{1,64}$/;

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid form" }, { status: 400 });

  const slug = String(form.get("slug") ?? "");
  const kind = String(form.get("kind") ?? ""); // "model" | "photo"
  const file = form.get("file");
  if (!SAFE_SLUG.test(slug)) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }
  if (kind !== "model" && kind !== "photo" && kind !== "archive" && kind !== "derived") {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  const isZipKind = kind === "archive" || kind === "derived";
  const limit = isZipKind ? MAX_BYTES_ARCHIVE : MAX_BYTES;
  if (file.size > limit) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }
  const ext = path.extname(file.name).toLowerCase();
  if (isZipKind) {
    if (ext !== ".zip") {
      return NextResponse.json({ error: "unsupported extension" }, { status: 415 });
    }
    if (file.type && !ARCHIVE_MIMES.has(file.type)) {
      return NextResponse.json({ error: "unsupported mime" }, { status: 415 });
    }
  } else {
    if (!ALLOWED_EXTS.has(ext)) {
      return NextResponse.json({ error: "unsupported extension" }, { status: 415 });
    }
    if (file.type && !ALLOWED_MIMES.has(file.type)) {
      // mime is best-effort; many browsers send empty for .glb. fall through if blank.
      return NextResponse.json({ error: "unsupported mime" }, { status: 415 });
    }
  }

  await ensureStorageRoot();
  const dir = path.join(RELIC_STORAGE_ROOT, slug);
  await fs.mkdir(dir, { recursive: true });

  const fname =
    kind === "model"
      ? `model${ext}`
      : kind === "archive"
        ? `archive-${Date.now()}.zip`
        : kind === "derived"
          ? `derived-${Date.now()}.zip`
          : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const abs = path.join(dir, fname);
  const buf = Buffer.from(await file.arrayBuffer());

  try {
    await fs.writeFile(abs, buf);
    const relPath = `/${slug}/${fname}`;
    return NextResponse.json({ ok: true, path: relPath });
  } catch (e) {
    console.error("[api/admin/relics/upload] write failed", e);
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
}
