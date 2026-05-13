import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { resolveRelicAsset } from "@/lib/relicStorage";
import { pipelineDirsForSlug } from "@/lib/relics/pipeline/context";

// "下载原始资料包" — packs everything the admin curated for this relic:
//   - source/             original upload (verbatim zip or extracted files)
//   - uploads/            admin-uploaded user candidate images (cand-user-*)
//   - materials/          additional materials (docs/images/archives/urls.txt)
// The button on the detail page is always enabled and only fails (404)
// when the relic has no contents at all.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const relic = await prisma.relic.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      rarity: true,
      archivePath: true,
      candidateImages: true,
      materials: true,
    },
  });
  if (!relic) return new NextResponse("not found", { status: 404 });

  const [user, unlockedIds] = await Promise.all([getCurrentUser(), getUnlockedRelicIds()]);
  if (canAccessRelic(relic, user, unlockedIds).level === "RED") {
    return new NextResponse("forbidden", { status: 403 });
  }

  const dirs = pipelineDirsForSlug(relic.slug);
  try {
    const zip = new JSZip();
    let added = 0;

    // 1. Original source — verbatim zip or walked extracted/.
    if (relic.archivePath) {
      const abs = resolveRelicAsset(relic.archivePath);
      if (abs) {
        try {
          zip.file(`source/${path.basename(abs)}`, await fs.readFile(abs));
          added++;
        } catch (e) {
          console.warn("[api/relics/archive] could not read original archive", e);
        }
      }
    } else {
      added += await packDirRecursive(zip, dirs.extracted, "source");
    }

    // 2. Admin-uploaded candidate images (those uploaded post-creation via
    //    the candidate POST endpoint — filename starts with `cand-user-`).
    //    Pipeline-staged cand-<ts>-<i> images are excluded since they're
    //    just copies of the original uploads already in source/.
    if (Array.isArray(relic.candidateImages)) {
      for (const c of relic.candidateImages as unknown[]) {
        if (
          !isObject(c) ||
          c.source !== "user" ||
          typeof c.path !== "string" ||
          c.deleted === true
        ) {
          continue;
        }
        const basename = path.basename(c.path);
        if (!basename.startsWith("cand-user-")) continue;
        const abs = resolveRelicAsset(c.path);
        if (!abs) continue;
        try {
          const name = typeof c.originalFilename === "string" ? c.originalFilename : basename;
          zip.file(`uploads/${name}`, await fs.readFile(abs));
          added++;
        } catch (e) {
          console.warn("[api/relics/archive] could not read candidate", c.path, e);
        }
      }
    }

    // 3. Materials — files + a urls.txt for webpage entries.
    if (Array.isArray(relic.materials)) {
      const urls: string[] = [];
      for (const m of relic.materials as unknown[]) {
        if (!isObject(m)) continue;
        if (m.kind === "webpage" && typeof m.url === "string") {
          urls.push(m.url);
          continue;
        }
        if (typeof m.path !== "string") continue;
        const abs = resolveRelicAsset(m.path);
        if (!abs) continue;
        try {
          const name = typeof m.originalName === "string" ? m.originalName : path.basename(abs);
          zip.file(`materials/${name}`, await fs.readFile(abs));
          added++;
        } catch (e) {
          console.warn("[api/relics/archive] could not read material", m.path, e);
        }
      }
      if (urls.length > 0) {
        zip.file("materials/urls.txt", urls.join("\n") + "\n");
        added++;
      }
    }

    if (added === 0) return new NextResponse("not found", { status: 404 });

    const buf = await zip.generateAsync({ type: "uint8array" });
    return new NextResponse(new Blob([buf as BlobPart], { type: "application/zip" }), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${relic.slug}-source.zip"`,
        // No caching — admin can edit candidates/materials any time.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("[api/relics/archive] pack failed", { id, e });
    return new NextResponse("not found", { status: 404 });
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function packDirRecursive(
  zip: JSZip,
  rootAbs: string,
  zipPrefix: string,
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
      count += await packDirRecursive(zip, abs, rel);
    } else if (ent.isFile()) {
      try {
        zip.file(rel, await fs.readFile(abs));
        count++;
      } catch (e) {
        console.warn("[api/relics/archive] could not read", abs, e);
      }
    }
  }
  return count;
}
