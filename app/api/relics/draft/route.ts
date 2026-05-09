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

const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_PER_FILE_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 30;
const MAX_DESCRIPTION = 2000;
// Whitelist of accepted upload types. Add new ones consciously — anything
// landing in source/extracted/ becomes browsable in the derived archive and
// fed to the scribe agent.
const ALLOWED_EXTS = new Set([
  ".zip",
  ".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".gif", ".bmp", ".tiff",
  ".pdf",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".md", ".rtf", ".csv", ".json",
  ".mp3", ".m4a", ".wav",
  ".mp4", ".mov", ".webm",
]);

function sanitizeName(name: string): string {
  // Strip path separators + control chars; collapse spaces; cap length.
  const base = name.replace(/[\\/]/g, "_").replace(/[\x00-\x1f]/g, "").trim();
  return (base || "file").slice(0, 180);
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

  // New contract: form field "files" can repeat (FormData.getAll). Legacy
  // contract: a single "archive" field. Accept either; fail closed if both empty.
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

  // Mode split: a single ZIP keeps the existing extract path. Anything else
  // (mixed types or multiple files) is staged directly into source/extracted/
  // and EXTRACT_ZIP becomes a no-op.
  const isSingleZip =
    filesRaw.length === 1 &&
    path.extname(filesRaw[0].name).toLowerCase() === ".zip";

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
  const extractedDir = path.join(sourceDir, "extracted");
  await fs.mkdir(sourceDir, { recursive: true });

  let archiveRelative: string | null = null;
  try {
    if (isSingleZip) {
      const archiveFileName = `archive-${Date.now()}.zip`;
      const archiveAbs = path.join(sourceDir, archiveFileName);
      const buf = Buffer.from(await filesRaw[0].arrayBuffer());
      await fs.writeFile(archiveAbs, buf);
      archiveRelative = `/${slug}/source/${archiveFileName}`;
    } else {
      await fs.mkdir(extractedDir, { recursive: true });
      const usedNames = new Set<string>();
      for (const f of filesRaw) {
        let name = sanitizeName(f.name);
        // De-dup on collision: name.ext → name (1).ext, name (2).ext, ...
        if (usedNames.has(name)) {
          const ext = path.extname(name);
          const stem = name.slice(0, name.length - ext.length);
          let i = 1;
          while (usedNames.has(`${stem} (${i})${ext}`)) i++;
          name = `${stem} (${i})${ext}`;
        }
        usedNames.add(name);
        const dst = path.join(extractedDir, name);
        if (!dst.startsWith(extractedDir)) continue; // defense-in-depth
        const buf = Buffer.from(await f.arrayBuffer());
        await fs.writeFile(dst, buf);
      }
    }
  } catch (e) {
    console.error("[api/relics/draft] write failed", e);
    try {
      await fs.rm(relicDir, { recursive: true, force: true });
    } catch {}
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }

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
