// POST /api/relics/[id]/model/upload — admin-only multipart upload of a
// pre-made GLB file. Skips the whole Meshy generation pipeline; the file
// goes straight to disk and Relic.modelPath is updated to point at it.
//
// Use case: admin already has a hand-crafted (or externally sourced)
// 3D model and doesn't need image-to-3D. The Meshy modal's step 2
// column surfaces this as "或 · 直接上传 GLB" alongside the standard
// ▶ 开始生成 button.
//
// Validation: 50 MB cap, .glb extension, magic-byte check
// (first 4 bytes = "glTF" little-endian). On success returns
// `{ modelPath }`; frontend triggers a parent refresh so step 3 picks
// up the new model via the standard /api/relics/[id]/model stream.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { recordRelicLog } from "@/lib/relicLog";
import { persistRelicAsset, PersistAssetError } from "@/lib/relics/persistAsset";

// 50 MB upper bound. Meshy outputs land around 5–15 MB; hand-crafted
// assets can be bigger but anything past 50 MB is suspicious for a relic
// detail-page viewer and should be optimised upstream.
const MAX_BYTES = 50 * 1024 * 1024;
// 4 bytes of "glTF" in little-endian = 0x46546c67. Rejects renamed
// non-GLB files (e.g. a .zip with .glb extension).
const GLB_MAGIC = 0x46546c67;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { id } = await params;
  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, slug: true, nameEn: true },
  });
  if (!relic) return NextResponse.json({ error: "relic not found" }, { status: 404 });

  let formData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing 'file' field" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (${file.size} bytes, max ${MAX_BYTES})` },
      { status: 413 },
    );
  }
  const lowerName = (file.name || "").toLowerCase();
  if (!lowerName.endsWith(".glb")) {
    return NextResponse.json({ error: "only .glb files accepted" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  // Magic byte sniff — reject renamed non-GLB blobs before we write them.
  if (buf.byteLength < 4 || buf.readUInt32LE(0) !== GLB_MAGIC) {
    return NextResponse.json(
      { error: "not a binary GLB file (magic mismatch)" },
      { status: 400 },
    );
  }

  let saved;
  try {
    saved = await persistRelicAsset({
      relicSlug: relic.slug,
      kind: "model",
      base64: buf.toString("base64"),
      contentType: "model/gltf-binary",
      ext: ".glb",
    });
  } catch (e) {
    if (e instanceof PersistAssetError) {
      const status = e.code === "PATH_TRAVERSAL_BLOCKED" ? 400 : 500;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error("[api/relics/model/upload] persist failed", e);
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }

  await prisma.relic.update({
    where: { id: relic.id },
    data: { modelPath: saved.savedPath },
  });

  await recordRelicLog({
    action: "EDITED",
    relic: { id: relic.id, slug: relic.slug, name: relic.nameEn || relic.slug },
    actor: { id: me.id, name: me.name },
    details: { fields: ["modelPath"], source: "manual-upload", bytes: saved.bytes },
  });

  return NextResponse.json(
    { modelPath: saved.savedPath, bytes: saved.bytes },
    { status: 201 },
  );
}
