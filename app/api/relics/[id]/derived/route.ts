import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { resolveRelicAsset } from "@/lib/relicStorage";
import { pipelineDirsForSlug } from "@/lib/relics/pipeline/context";

// "下载归档资料包" — everything related to this relic, packed on the fly so the
// archive always reflects the latest derived assets (admin-triggered 2D
// enhance, 3D model, etc. arrive long after the original PACK_DERIVED step).
//
// Contents:
//   - source/                 user's original uploads (single .zip verbatim,
//                             or recursively-packed source/extracted/*)
//   - derived/                everything in derived/ except old PACK_DERIVED
//                             snapshots (cand-*, enhanced-*, model-*, …)
//   - metadata.json           full relic snapshot (lore, candidates,
//                             enhancedImagePath, modelPath, …) at request time
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const relic = await prisma.relic.findUnique({ where: { id } });
  if (!relic) return new NextResponse("not found", { status: 404 });

  const [user, unlockedIds] = await Promise.all([getCurrentUser(), getUnlockedRelicIds()]);
  if (canAccessRelic(relic, user, unlockedIds).level === "RED") {
    return new NextResponse("forbidden", { status: 403 });
  }

  const dirs = pipelineDirsForSlug(relic.slug);
  const zip = new JSZip();
  let added = 0;

  // 1. originals under source/.
  if (relic.archivePath) {
    const origAbs = resolveRelicAsset(relic.archivePath);
    if (origAbs) {
      try {
        zip.file(`source/${path.basename(origAbs)}`, await fs.readFile(origAbs));
        added++;
      } catch (e) {
        console.warn("[api/relics/derived] could not read original archive", e);
      }
    }
  } else {
    added += await packDirRecursive(zip, dirs.extracted, "source");
  }

  // 2. derived/* — every current asset except prior PACK_DERIVED snapshots
  //    (those would nest old archives inside this one).
  added += await packDirRecursive(zip, dirs.derived, "derived", (name) =>
    !name.startsWith("derived-"),
  );

  // 3. live metadata snapshot.
  const metadata = {
    generatedAt: new Date().toISOString(),
    relic: {
      id: relic.id,
      slot: relic.slot,
      slug: relic.slug,
      nameEn: relic.nameEn,
      nameZh: relic.nameZh,
      classifEn: relic.classifEn,
      classifZh: relic.classifZh,
      rarity: relic.rarity,
      iconKey: relic.iconKey,
      loreEn: relic.loreEn,
      loreZh: relic.loreZh,
      status: relic.status,
      draftNote: relic.draftNote,
      primaryImagePath: relic.primaryImagePath,
      enhancedImagePath: relic.enhancedImagePath,
      modelPath: relic.modelPath,
      candidateImages: relic.candidateImages,
    },
  };
  zip.file("metadata.json", JSON.stringify(metadata, null, 2));
  added++;

  if (added === 0) return new NextResponse("not found", { status: 404 });

  try {
    const buf = await zip.generateAsync({ type: "uint8array" });
    return new NextResponse(new Blob([buf as BlobPart], { type: "application/zip" }), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${relic.slug}-archive.zip"`,
        // Always-fresh: derived assets can grow at any time after admin
        // triggers 2dEnhance / 3dCreate.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("[api/relics/derived] zip failed", { id, e });
    return new NextResponse("pack failed", { status: 500 });
  }
}

async function packDirRecursive(
  zip: JSZip,
  rootAbs: string,
  zipPrefix: string,
  filter?: (name: string) => boolean,
): Promise<number> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(rootAbs, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const ent of entries) {
    const abs = path.join(rootAbs, ent.name);
    const rel = zipPrefix ? `${zipPrefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      count += await packDirRecursive(zip, abs, rel, filter);
    } else if (ent.isFile()) {
      if (filter && !filter(ent.name)) continue;
      try {
        zip.file(rel, await fs.readFile(abs));
        count++;
      } catch (e) {
        console.warn("[api/relics/derived] could not read", abs, e);
      }
    }
  }
  return count;
}
