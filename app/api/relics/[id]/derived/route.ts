import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { resolveRelicAsset } from "@/lib/relicStorage";

// "下载归档资料包" — derived assets organized into 6 admin-facing groups
// so the archive is human-browseable, not just a flat dump:
//   1. info/             intro.md (name / classif / rarity / lore)
//   2. candidates/       user-uploaded candidate images (source = "user")
//   3. network/          AI-fetched candidate images (source = "network")
//   4. materials/        admin-uploaded files + a websites.md for URLs
//   5. enhanced/         all 2D-enhance outputs (transparent PNG)
//   6. model/            all 3D model outputs (GLB)
//   metadata.json        full DB snapshot for the curious
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

  const zip = new JSZip();
  let added = 0;

  // 1. info — single-doc bilingual intro markdown.
  zip.file("info/intro.md", buildIntroMarkdown(relic));
  added++;

  // 2 + 3. candidates / network — split by source, skip deleted.
  if (Array.isArray(relic.candidateImages)) {
    for (const c of relic.candidateImages as unknown[]) {
      if (!isObject(c) || typeof c.path !== "string" || c.deleted === true) continue;
      const folder = c.source === "network" ? "network" : "candidates";
      const abs = resolveRelicAsset(c.path);
      if (!abs) continue;
      try {
        const name =
          typeof c.originalFilename === "string" ? c.originalFilename : path.basename(abs);
        zip.file(`${folder}/${name}`, await fs.readFile(abs));
        added++;
      } catch (e) {
        console.warn("[api/relics/derived] candidate read failed", c.path, e);
      }
    }
  }

  // 4. materials — uploaded files + URLs.md.
  if (Array.isArray(relic.materials)) {
    const urls: { name: string; url: string }[] = [];
    for (const m of relic.materials as unknown[]) {
      if (!isObject(m)) continue;
      if (m.kind === "webpage" && typeof m.url === "string") {
        urls.push({
          name: typeof m.originalName === "string" ? m.originalName : m.url,
          url: m.url,
        });
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
        console.warn("[api/relics/derived] material read failed", m.path, e);
      }
    }
    if (urls.length > 0) {
      const md =
        `# Websites\n\n` +
        urls.map((u) => `- [${u.name}](${u.url})`).join("\n") +
        "\n";
      zip.file("materials/websites.md", md);
      added++;
    }
  }

  // 5. enhanced — current 2D-enhance asset (one per relic).
  if (relic.enhancedImagePath) {
    const abs = resolveRelicAsset(relic.enhancedImagePath);
    if (abs) {
      try {
        zip.file(`enhanced/${path.basename(abs)}`, await fs.readFile(abs));
        added++;
      } catch (e) {
        console.warn("[api/relics/derived] enhanced read failed", e);
      }
    }
  }

  // 6. model — current 3D asset (one per relic).
  if (relic.modelPath) {
    const abs = resolveRelicAsset(relic.modelPath);
    if (abs) {
      try {
        zip.file(`model/${path.basename(abs)}`, await fs.readFile(abs));
        added++;
      } catch (e) {
        console.warn("[api/relics/derived] model read failed", e);
      }
    }
  }

  // Snapshot for tooling / future re-import.
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
      materials: relic.materials,
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
        // Always fresh — admin edits flow through at any moment.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("[api/relics/derived] zip failed", { id, e });
    return new NextResponse("pack failed", { status: 500 });
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function buildIntroMarkdown(r: {
  slot: number;
  slug: string;
  nameEn: string;
  nameZh: string;
  classifEn: string;
  classifZh: string;
  rarity: string;
  iconKey: string | null;
  loreEn: string | null;
  loreZh: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`# ${r.nameZh} / ${r.nameEn}`);
  lines.push("");
  lines.push(`- **编号 / Slot**: ${String(r.slot).padStart(3, "0")}`);
  lines.push(`- **路径 / Slug**: ${r.slug}`);
  lines.push(`- **副标 / Classif**: ${r.classifZh} / ${r.classifEn}`);
  lines.push(`- **品阶 / Rarity**: ${r.rarity}`);
  if (r.iconKey) lines.push(`- **图标 / Icon**: ${r.iconKey}`);
  lines.push("");
  if (r.loreZh) {
    lines.push(`## 圣记 (中)`);
    lines.push("");
    lines.push(r.loreZh);
    lines.push("");
  }
  if (r.loreEn) {
    lines.push(`## Lore (EN)`);
    lines.push("");
    lines.push(r.loreEn);
    lines.push("");
  }
  return lines.join("\n");
}
