// New upload endpoint replacing /api/relics/draft. Creates a RelicDraft row
// (NOT a Relic) and stages files under private/relics/_drafts/<draftId>/.
// The pipeline writes AI-generated metadata into RelicDraft.generatedMetadata;
// the admin previews/edits in a modal and clicks 确认存入 to materialise a
// real Relic row (see /api/relic-drafts/[id]/confirm).
//
// Slot handling: slot is locked at upload time via RelicDraft.slot @unique.
// We also reject occupancy by an existing Relic row to keep the vault grid
// invariant. Released by either confirm (transferred to the new Relic) or
// DELETE (cancel).

import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import {
  ensureStorageRoot,
  RELIC_STORAGE_ROOT,
} from "@/lib/relicStorage";
import { runDraftPipeline } from "@/lib/relics/pipeline/draft/runner";
import { ensureServerInit } from "@/lib/server-init";

// Image-only uploads, cap = USER UPLOADS grid MAX_SLOTS so server-side
// limit matches the visible curation slots. Non-image / archive types
// removed 2026-05-14 — additional materials go through the post-creation
// 其他资料 module instead.
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_PER_FILE_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 8;
const MAX_DESCRIPTION = 2000;
const ALLOWED_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".gif", ".bmp", ".tiff",
]);

function sanitizeName(name: string): string {
  const base = name.replace(/[\\/]/g, "_").replace(/[\x00-\x1f]/g, "").trim();
  return (base || "file").slice(0, 180);
}

// Lists current admin's drafts. Used by the vault grid to render draft cells.
// Other admins' drafts are not exposed — they cause "slot occupied" 409 if
// another admin tries to upload to the same cell, but the cell stays empty
// in their grid until they refresh.
export async function GET() {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
  await ensureServerInit();

  const drafts = await prisma.relicDraft.findMany({
    where: { uploadedById: me.id },
    select: {
      id: true,
      slot: true,
      status: true,
      step: true,
      progress: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ drafts });
}

export async function POST(req: NextRequest) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
  await ensureServerInit();

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid form" }, { status: 400 });

  const slotRaw = form.get("slot");
  const description = String(form.get("description") ?? "").slice(0, MAX_DESCRIPTION);

  const filesRaw: File[] = [];
  for (const v of form.getAll("files")) {
    if (v instanceof File && v.size > 0) filesRaw.push(v);
  }
  if (filesRaw.length === 0) {
    const legacy = form.get("archive");
    if (legacy instanceof File && legacy.size > 0) filesRaw.push(legacy);
  }

  const slot = Number(slotRaw);
  if (!Number.isInteger(slot) || slot < 1) {
    return NextResponse.json({ error: "invalid slot" }, { status: 400 });
  }
  if (filesRaw.length === 0) {
    return NextResponse.json({ error: "missing files" }, { status: 400 });
  }
  if (filesRaw.length > MAX_FILES) {
    return NextResponse.json({ error: "too many files" }, { status: 413 });
  }
  let totalBytes = 0;
  for (const f of filesRaw) {
    if (f.size > MAX_PER_FILE_BYTES) {
      return NextResponse.json({ error: "file too large" }, { status: 413 });
    }
    totalBytes += f.size;
    const ext = path.extname(f.name).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      return NextResponse.json(
        { error: `unsupported extension: ${ext || "(none)"}` },
        { status: 415 },
      );
    }
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json({ error: "upload too large" }, { status: 413 });
  }

  // Slot must be free in BOTH tables — Relic occupies a slot once confirmed,
  // RelicDraft holds it during preview.
  const [existingRelic, existingDraft] = await Promise.all([
    prisma.relic.findUnique({ where: { slot } }),
    prisma.relicDraft.findUnique({ where: { slot } }),
  ]);
  if (existingRelic || existingDraft) {
    return NextResponse.json({ error: "slot occupied" }, { status: 409 });
  }

  // Create the draft row first to get the id, which keys the workspace dir.
  let draftId: string;
  try {
    const created = await prisma.relicDraft.create({
      data: {
        slot,
        uploadedById: me.id,
        draftNote: description || null,
        status: "PENDING",
        step: "ENQUEUED",
      },
      select: { id: true },
    });
    draftId = created.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "slot occupied" }, { status: 409 });
    }
    console.error("[api/relic-drafts] create row failed", e);
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }

  await ensureStorageRoot();
  const workspaceRel = `_drafts/${draftId}`;
  const workspaceAbs = path.join(RELIC_STORAGE_ROOT, "_drafts", draftId);
  const sourceAbs = path.join(workspaceAbs, "source");
  const extractedAbs = path.join(sourceAbs, "extracted");
  const derivedAbs = path.join(workspaceAbs, "derived");
  await fs.mkdir(sourceAbs, { recursive: true });
  await fs.mkdir(derivedAbs, { recursive: true });

  const archiveRelative: string | null = null;
  try {
    // Image-only upload — drop each file directly into source/extracted/.
    // No zip handling: that path was removed 2026-05-14 to match the 8-image
    // USER UPLOADS limit.
    await fs.mkdir(extractedAbs, { recursive: true });
    const usedNames = new Set<string>();
    for (const f of filesRaw) {
      let name = sanitizeName(f.name);
      if (usedNames.has(name)) {
        const ext = path.extname(name);
        const stem = name.slice(0, name.length - ext.length);
        let i = 1;
        while (usedNames.has(`${stem} (${i})${ext}`)) i++;
        name = `${stem} (${i})${ext}`;
      }
      usedNames.add(name);
      const dst = path.join(extractedAbs, name);
      if (!dst.startsWith(extractedAbs)) continue;
      const buf = Buffer.from(await f.arrayBuffer());
      await fs.writeFile(dst, buf);
    }
  } catch (e) {
    console.error("[api/relic-drafts] write failed", e);
    try {
      await fs.rm(workspaceAbs, { recursive: true, force: true });
    } catch {}
    try {
      await prisma.relicDraft.delete({ where: { id: draftId } });
    } catch {}
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }

  try {
    await prisma.relicDraft.update({
      where: { id: draftId },
      data: {
        archivePath: archiveRelative,
        workspaceDir: `/${workspaceRel}`,
        extractedDir: `/${workspaceRel}/source/extracted`,
        derivedDir: `/${workspaceRel}/derived`,
      },
    });
  } catch (e) {
    console.error("[api/relic-drafts] update paths failed", e);
    try {
      await fs.rm(workspaceAbs, { recursive: true, force: true });
    } catch {}
    try {
      await prisma.relicDraft.delete({ where: { id: draftId } });
    } catch {}
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }

  void runDraftPipeline(draftId).catch((e) => {
    console.error("[api/relic-drafts] pipeline kickoff threw", { draftId, e });
  });

  return NextResponse.json({ draftId, slot }, { status: 201 });
}
