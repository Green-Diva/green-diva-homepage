import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { resolveRelicAsset } from "@/lib/relicStorage";
import { pipelineDirsForSlug } from "@/lib/relics/pipeline/context";

// "下载原始资料包" — the user's original uploads only.
//   - Single-zip upload: stream that .zip verbatim.
//   - Multi-file upload: walk source/extracted/* and pack on-the-fly.
// Either way the response is a zip; the button on the detail page is always
// enabled and only fails (404) when the relic genuinely has no source files.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, slug: true, rarity: true, archivePath: true },
  });
  if (!relic) return new NextResponse("not found", { status: 404 });

  const [user, unlockedIds] = await Promise.all([getCurrentUser(), getUnlockedRelicIds()]);
  if (canAccessRelic(relic, user, unlockedIds).level === "RED") {
    return new NextResponse("forbidden", { status: 403 });
  }

  // Path A: user uploaded a single .zip — stream it untouched.
  if (relic.archivePath) {
    const abs = resolveRelicAsset(relic.archivePath);
    if (abs) {
      try {
        const buf = await fs.readFile(abs);
        return new NextResponse(buf, {
          status: 200,
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${relic.slug}-source.zip"`,
            "Cache-Control": "private, max-age=3600",
          },
        });
      } catch (e) {
        console.error("[api/relics/archive] read original zip failed", { id, e });
        // fall through to extracted-dir packing below
      }
    }
  }

  // Path B: pack source/extracted/* on the fly.
  const dirs = pipelineDirsForSlug(relic.slug);
  try {
    const zip = new JSZip();
    const added = await packDirRecursive(zip, dirs.extracted, "");
    if (added === 0) {
      return new NextResponse("not found", { status: 404 });
    }
    const buf = await zip.generateAsync({ type: "uint8array" });
    return new NextResponse(new Blob([buf as BlobPart], { type: "application/zip" }), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${relic.slug}-source.zip"`,
        // No caching — directory contents can change (admin re-uploads, future
        // edits) and we don't want a stale zip served from a CDN.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("[api/relics/archive] pack failed", { id, e });
    return new NextResponse("not found", { status: 404 });
  }
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
