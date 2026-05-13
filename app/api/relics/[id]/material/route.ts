// POST /api/relics/[id]/material — admin-only. Uploads a supporting
// material file (image / document / archive) into private/relics/<slug>/
// materials/, appends to Relic.materials, returns the new entry.
// GET /api/relics/[id]/material?path=<path> — streams a stored material
// file for preview/download. Path must be in the relic's materials array.
//
// Webpages don't need this endpoint — the form sends URLs directly via
// the relic PATCH (Relic.materials field).

import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuthError, getCurrentUser, requireAdmin } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { resolveRelicAsset } from "@/lib/relicStorage";
import { pipelineDirsForSlug } from "@/lib/relics/pipeline/context";
import { respondError, respondAuthError } from "@/lib/api-error";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".rtf": "application/rtf",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",
};

const ALLOWED_EXTS: Record<"image" | "document" | "archive", Set<string>> = {
  image: new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"]),
  document: new Set([".pdf", ".doc", ".docx", ".txt", ".md", ".rtf", ".odt"]),
  archive: new Set([".zip", ".tar", ".gz", ".7z", ".rar"]),
};
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const requestedPath = new URL(req.url).searchParams.get("path");
  if (!requestedPath) return new NextResponse("missing ?path", { status: 400 });
  const wantDownload = new URL(req.url).searchParams.get("download") === "1";

  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, slug: true, rarity: true, materials: true },
  });
  if (!relic) return new NextResponse("not found", { status: 404 });
  if (!requestedPath.startsWith(`/${relic.slug}/`)) {
    return new NextResponse("path not in this relic's namespace", { status: 403 });
  }
  if (!Array.isArray(relic.materials)) {
    return new NextResponse("relic has no materials", { status: 404 });
  }
  const match = (relic.materials as unknown[]).find(
    (m): m is { path: string; originalName?: string } =>
      isObject(m) && m.path === requestedPath,
  );
  if (!match) return new NextResponse("path not in materials", { status: 404 });

  const [user, unlockedIds] = await Promise.all([getCurrentUser(), getUnlockedRelicIds()]);
  if (canAccessRelic(relic, user, unlockedIds).level === "RED") {
    return new NextResponse("forbidden", { status: 403 });
  }

  const abs = resolveRelicAsset(requestedPath);
  if (!abs) return new NextResponse("forbidden", { status: 403 });

  try {
    const buf = await fs.readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    };
    if (wantDownload) {
      const name = match.originalName ?? path.basename(abs);
      headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(name)}"`;
    }
    return new NextResponse(buf, { status: 200, headers });
  } catch (e) {
    console.error("[api/relics/material GET]", e);
    return new NextResponse("not found", { status: 404 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    try {
      await requireAdmin();
    } catch (e) {
      if (e instanceof AuthError) return respondAuthError(e);
      throw e;
    }
    const { id } = await ctx.params;
    const relic = await prisma.relic.findUnique({
      where: { id },
      select: { id: true, slug: true, materials: true },
    });
    if (!relic) return respondError("NOT_FOUND", "relic not found", 404);

    const form = await req.formData().catch(() => null);
    if (!form) return respondError("VALIDATION_FAILED", "invalid form", 400);
    const file = form.get("file");
    const kindField = form.get("kind");
    if (!(file instanceof File)) {
      return respondError("VALIDATION_FAILED", "missing file", 400);
    }
    if (kindField !== "image" && kindField !== "document" && kindField !== "archive") {
      return respondError("VALIDATION_FAILED", "invalid kind", 400);
    }
    const kind = kindField as "image" | "document" | "archive";
    if (file.size > MAX_UPLOAD_BYTES) {
      return respondError("VALIDATION_FAILED", "file too large", 413);
    }
    const ext = path.extname(file.name).toLowerCase() || ".bin";
    if (!ALLOWED_EXTS[kind].has(ext)) {
      return respondError("VALIDATION_FAILED", `unsupported ${kind} extension: ${ext}`, 400);
    }

    const dirs = pipelineDirsForSlug(relic.slug);
    const materialsDir = path.join(dirs.root, "materials");
    await fs.mkdir(materialsDir, { recursive: true });
    const fname = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const abs = path.join(materialsDir, fname);
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(abs, buf);

    const newMaterial = {
      kind,
      path: `/${relic.slug}/materials/${fname}`,
      originalName: file.name.slice(0, 256),
      addedAt: new Date().toISOString(),
    };
    const existing = Array.isArray(relic.materials) ? (relic.materials as unknown[]) : [];
    const next = [...existing, newMaterial];
    await prisma.relic.update({
      where: { id },
      data: { materials: next as unknown as Prisma.InputJsonValue },
    });
    return NextResponse.json({ material: newMaterial });
  } catch (e) {
    console.error("[api/relics/material] upload failed", e);
    return respondError("HANDLER_ERROR", `upload error: ${(e as Error).message}`, 500);
  }
}
