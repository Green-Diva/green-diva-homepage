import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { resolveRelicAsset } from "@/lib/relicStorage";
import type { PipelineContext, StepResult } from "../context";

export type PackDerivedResult = {
  derivedRelativePath: string;
  fileName: string;
};

/**
 * Bundles derived/* + the original archive + a metadata.json snapshot into a
 * single ZIP and stores the relative path on relic.derivedArchivePath. This is
 * real (jszip) even in P3 — the upstream steps are mocked but their outputs do
 * exist on disk, so the archive is still useful to inspect.
 */
export async function stepPackDerived(
  ctx: PipelineContext,
): Promise<StepResult<PackDerivedResult>> {
  const zip = new JSZip();

  // 1. all derived/ files
  const derivedFiles = await safeReaddir(ctx.dirs.derived);
  for (const name of derivedFiles) {
    const abs = path.join(ctx.dirs.derived, name);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) continue;
    if (name.startsWith("derived-")) continue; // don't nest old derived ZIPs
    zip.file(`derived/${name}`, await fs.readFile(abs));
  }

  // 2. originals
  //   - ZIP-mode: include the uploaded archive verbatim under source/
  //   - multimodal-mode: walk source/extracted/ (files were staged there at
  //     upload time) and include each under source/
  if (ctx.relic.archivePath) {
    const origAbs = resolveRelicAsset(ctx.relic.archivePath);
    if (origAbs) {
      try {
        zip.file(`source/${path.basename(origAbs)}`, await fs.readFile(origAbs));
      } catch (e) {
        console.warn("[packDerived] could not read original archive", e);
      }
    }
  } else {
    await packDirRecursive(zip, ctx.dirs.extracted, "source");
  }

  // 3. metadata snapshot
  const fresh = await prisma.relic.findUnique({ where: { id: ctx.relic.id } });
  const metadata = {
    generatedAt: new Date().toISOString(),
    relic: fresh
      ? {
          id: fresh.id,
          slot: fresh.slot,
          slug: fresh.slug,
          nameEn: fresh.nameEn,
          nameZh: fresh.nameZh,
          classifEn: fresh.classifEn,
          classifZh: fresh.classifZh,
          rarity: fresh.rarity,
          iconKey: fresh.iconKey,
          loreEn: fresh.loreEn,
          loreZh: fresh.loreZh,
          status: fresh.status,
          draftNote: fresh.draftNote,
        }
      : null,
    pipelineResults: Object.fromEntries(ctx.results),
  };
  zip.file("metadata.json", JSON.stringify(metadata, null, 2));

  const fileName = `derived-${Date.now()}.zip`;
  const dstAbs = path.join(ctx.dirs.derived, fileName);
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  await fs.writeFile(dstAbs, buf);

  const derivedRelativePath = `/${ctx.relic.slug}/derived/${fileName}`;
  await prisma.relic.update({
    where: { id: ctx.relic.id },
    data: { derivedArchivePath: derivedRelativePath },
  });

  return { ok: true, data: { derivedRelativePath, fileName } };
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function packDirRecursive(zip: JSZip, rootAbs: string, zipPrefix: string): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(rootAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = path.join(rootAbs, ent.name);
    const rel = `${zipPrefix}/${ent.name}`;
    if (ent.isDirectory()) {
      await packDirRecursive(zip, abs, rel);
    } else if (ent.isFile()) {
      try {
        zip.file(rel, await fs.readFile(abs));
      } catch (e) {
        console.warn("[packDerived] could not read", abs, e);
      }
    }
  }
}
