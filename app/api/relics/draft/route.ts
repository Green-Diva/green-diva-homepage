import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { ensureStorageRoot, RELIC_STORAGE_ROOT } from "@/lib/relicStorage";
import { recordRelicLog } from "@/lib/relicLog";
import { runRelicPipeline } from "@/lib/relics/pipeline";
import { ensureServerInit } from "@/lib/server-init";

const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const MAX_DESCRIPTION = 2000;
const ARCHIVE_MIMES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
]);

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
  const archive = form.get("archive");

  const slot = Number(slotRaw);
  if (!Number.isInteger(slot) || slot < 1) {
    return NextResponse.json({ error: "invalid slot" }, { status: 400 });
  }
  if (!(archive instanceof File)) {
    return NextResponse.json({ error: "missing archive" }, { status: 400 });
  }
  if (archive.size > MAX_ARCHIVE_BYTES) {
    return NextResponse.json({ error: "archive too large" }, { status: 413 });
  }
  const ext = path.extname(archive.name).toLowerCase();
  if (ext !== ".zip") {
    return NextResponse.json({ error: "unsupported extension" }, { status: 415 });
  }
  if (archive.type && !ARCHIVE_MIMES.has(archive.type)) {
    return NextResponse.json({ error: "unsupported mime" }, { status: 415 });
  }

  const existing = await prisma.relic.findUnique({ where: { slot } });
  if (existing) {
    return NextResponse.json({ error: "slot occupied" }, { status: 409 });
  }

  const slugSuffix = crypto.randomBytes(4).toString("hex").slice(0, 6);
  const slug = `vault-${String(slot).padStart(3, "0")}-${slugSuffix}`;
  const placeholderName = `Vault ${String(slot).padStart(3, "0")}`;
  const placeholderNameZh = `第 ${String(slot).padStart(3, "0")} 号草稿`;

  await ensureStorageRoot();
  const relicDir = path.join(RELIC_STORAGE_ROOT, slug);
  const sourceDir = path.join(relicDir, "source");
  await fs.mkdir(sourceDir, { recursive: true });

  const archiveFileName = `archive-${Date.now()}.zip`;
  const archiveAbs = path.join(sourceDir, archiveFileName);
  const buf = Buffer.from(await archive.arrayBuffer());
  try {
    await fs.writeFile(archiveAbs, buf);
  } catch (e) {
    console.error("[api/relics/draft] write failed", e);
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
  const archiveRelative = `/${slug}/source/${archiveFileName}`;

  let relicId: string;
  let jobId: string;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const relic = await tx.relic.create({
        data: {
          slot,
          slug,
          nameEn: placeholderName,
          nameZh: placeholderNameZh,
          classifEn: "DRAFT · PROCESSING",
          classifZh: "草稿 · 代理处理中",
          rarity: "COMMON",
          iconKey: "pending",
          archivePath: archiveRelative,
          status: "DRAFT",
          draftNote: description,
        },
        select: { id: true, slug: true, nameEn: true },
      });
      const job = await tx.relicProcessingJob.create({
        data: {
          relicId: relic.id,
          status: "PENDING",
          step: "ENQUEUED",
          progress: 0,
        },
        select: { id: true },
      });
      return { relic, job };
    });
    relicId = created.relic.id;
    jobId = created.job.id;

    await recordRelicLog({
      action: "CREATED",
      relic: { id: relicId, slug, name: created.relic.nameEn },
      actor: { id: me.id, name: me.name },
      details: { slot, draft: true },
    });
    await recordRelicLog({
      action: "PROCESSING_STARTED",
      relic: { id: relicId, slug, name: created.relic.nameEn },
      actor: { id: me.id, name: me.name },
      details: { jobId },
    });
  } catch (e) {
    console.error("[api/relics/draft] db failed", e);
    // best-effort cleanup of the bytes we just wrote
    try {
      await fs.rm(relicDir, { recursive: true, force: true });
    } catch {}
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }

  // Fire-and-forget. Pipeline is responsible for marking job FAILED on any
  // error; we never await it here.
  void runRelicPipeline(jobId).catch((e) => {
    console.error("[api/relics/draft] pipeline kickoff threw", { jobId, e });
  });

  return NextResponse.json({ relicId, slug, jobId }, { status: 201 });
}
