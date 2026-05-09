// INTERNAL handler: relic-files-summary
//
// vault-specific. Reads the post-EXTRACT_ZIP contents of a Relic's extracted/
// directory + the Relic's own draftNote, and produces a plain-text summary
// suitable for feeding into a downstream LLM_PROMPT skill.
//
// Internal layout intentionally splits "read files (vault-aware)" from
// "shape into summary (storage-agnostic)" so that when a second use case
// (visual-witness, machine-vision, ...) shows up we can hoist the second
// half into a shared `filesSummary` module without rewriting either side.
// Don't pre-extract today — there's only one caller; see CLAUDE.md "no
// premature abstraction".
//
// handlerConfig:
//   {
//     handler: "relic-files-summary",
//     maxFiles?: number,        // default 50; cap on file-listing length
//     maxTextBytes?: number,    // default 8192; per-text-file read cap
//     allowDryRun?: boolean,    // default false; gates `_dryRun` input mode
//   }
//
// Input:
//   { relicSlug: string } | { _dryRun: true }
// Output:
//   { userBrief: string, fileSummary: string, fileCount: number,
//     imageCount: number, otherCount: number }

import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db";
import { pipelineDirsForSlug } from "@/lib/relics/pipeline/context";
import { HandlerError, type SkillHandler } from "../../types";

const TEXT_EXTS = new Set([".txt", ".md", ".json", ".csv", ".log"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".heic", ".gif"]);
const SAFE_SLUG_RE = /^[a-zA-Z0-9_-]+$/;

const DEFAULT_MAX_FILES = 50;
const DEFAULT_MAX_TEXT_BYTES = 8192;

type FilesSummaryInput = {
  userBrief: string;
  files: Array<{
    relPath: string;
    sizeBytes: number;
    kind: "text" | "image" | "other";
    textExcerpt?: string;
  }>;
};

type FilesSummaryOutput = {
  userBrief: string;
  fileSummary: string;
  fileCount: number;
  imageCount: number;
  otherCount: number;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —
// Half 1: vault-aware file reading. Becomes a thin "translator" layer once
// half 2 is hoisted to a shared module.
// — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —
async function readVaultRelicFiles(opts: {
  relicSlug: string;
  maxFiles: number;
  maxTextBytes: number;
}): Promise<FilesSummaryInput> {
  if (!SAFE_SLUG_RE.test(opts.relicSlug)) {
    throw new HandlerError(
      `relic-files-summary: invalid relicSlug shape`,
      "INVALID_CONFIG",
    );
  }
  const relic = await prisma.relic.findUnique({
    where: { slug: opts.relicSlug },
    select: { draftNote: true },
  });
  if (!relic) {
    throw new HandlerError(
      `relic-files-summary: relic with slug "${opts.relicSlug}" not found`,
      "INVALID_CONFIG",
    );
  }
  const userBrief = (relic.draftNote ?? "").trim();

  const dirs = pipelineDirsForSlug(opts.relicSlug);
  const entries = await listFilesRecursive(dirs.extracted, opts.maxFiles);

  const files: FilesSummaryInput["files"] = [];
  for (const e of entries) {
    const ext = path.extname(e.relPath).toLowerCase();
    let kind: "text" | "image" | "other" = "other";
    let textExcerpt: string | undefined;
    if (IMAGE_EXTS.has(ext)) {
      kind = "image";
    } else if (TEXT_EXTS.has(ext) && e.sizeBytes > 0) {
      kind = "text";
      textExcerpt = await readTextHead(e.absPath, opts.maxTextBytes);
    }
    files.push({ relPath: e.relPath, sizeBytes: e.sizeBytes, kind, textExcerpt });
  }
  return { userBrief, files };
}

async function listFilesRecursive(
  rootAbs: string,
  cap: number,
): Promise<Array<{ relPath: string; absPath: string; sizeBytes: number }>> {
  const out: Array<{ relPath: string; absPath: string; sizeBytes: number }> = [];
  async function walk(dir: string): Promise<void> {
    if (out.length >= cap) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (out.length >= cap) return;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(abs);
      } else if (ent.isFile()) {
        const stat = await fs.stat(abs).catch(() => null);
        if (!stat) continue;
        out.push({
          relPath: path.relative(rootAbs, abs).split(path.sep).join("/"),
          absPath: abs,
          sizeBytes: stat.size,
        });
      }
    }
  }
  await walk(rootAbs);
  return out;
}

async function readTextHead(abs: string, maxBytes: number): Promise<string> {
  try {
    const handle = await fs.open(abs, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buf, 0, maxBytes, 0);
      return buf.subarray(0, bytesRead).toString("utf8").trim();
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

// — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —
// Half 2: storage-agnostic shaping. Pure function on FilesSummaryInput.
// Hoist this when a second module needs the same flattening logic.
// — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —
function buildSummary(input: FilesSummaryInput): FilesSummaryOutput {
  const { userBrief, files } = input;
  const imageCount = files.filter((f) => f.kind === "image").length;
  const otherCount = files.filter((f) => f.kind === "other").length;
  const textFiles = files.filter((f) => f.kind === "text");

  const lines: string[] = [];
  lines.push(`Total files: ${files.length} (images: ${imageCount}, text: ${textFiles.length}, other: ${otherCount})`);

  if (files.length > 0) {
    lines.push("");
    lines.push("File listing:");
    for (const f of files.slice(0, 30)) {
      lines.push(`  - ${f.relPath} (${formatSize(f.sizeBytes)}, ${f.kind})`);
    }
    if (files.length > 30) {
      lines.push(`  ...and ${files.length - 30} more`);
    }
  }

  if (textFiles.length > 0) {
    lines.push("");
    lines.push("Text excerpts:");
    for (const tf of textFiles.slice(0, 5)) {
      const excerpt = (tf.textExcerpt ?? "").slice(0, 600);
      if (!excerpt) continue;
      lines.push(`--- ${tf.relPath} ---`);
      lines.push(excerpt);
    }
  }

  return {
    userBrief,
    fileSummary: lines.join("\n"),
    fileCount: files.length,
    imageCount,
    otherCount,
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —
// Handler entry point.
// — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —
export const relicFilesSummary: SkillHandler = async (input, config) => {
  const maxFiles = typeof config.maxFiles === "number" ? config.maxFiles : DEFAULT_MAX_FILES;
  const maxTextBytes =
    typeof config.maxTextBytes === "number" ? config.maxTextBytes : DEFAULT_MAX_TEXT_BYTES;
  const allowDryRun = config.allowDryRun === true;

  if (!isObject(input)) {
    throw new HandlerError(
      "relic-files-summary: input must be { relicSlug } or { _dryRun: true }",
      "INVALID_CONFIG",
    );
  }

  if (input._dryRun === true) {
    if (!allowDryRun) {
      throw new HandlerError(
        "relic-files-summary: _dryRun input rejected (set allowDryRun: true in handlerConfig)",
        "INVALID_CONFIG",
      );
    }
    return buildSummary({
      userBrief: "示例:外婆 1962 年的家书,蓝色钢笔,半褪色字迹,谈到那年她种的玉米地。",
      files: [
        { relPath: "letter-page-1.jpg", sizeBytes: 2_400_000, kind: "image" },
        { relPath: "letter-page-2.jpg", sizeBytes: 2_100_000, kind: "image" },
        {
          relPath: "ocr/transcript.txt",
          sizeBytes: 1_280,
          kind: "text",
          textExcerpt: "亲爱的女儿:今年玉米地收成不错,你父亲终于换了那双新靴子...",
        },
      ],
    });
  }

  const relicSlug = typeof input.relicSlug === "string" ? input.relicSlug : null;
  if (!relicSlug) {
    throw new HandlerError(
      "relic-files-summary: input.relicSlug missing or not a string",
      "INVALID_CONFIG",
    );
  }

  const collected = await readVaultRelicFiles({ relicSlug, maxFiles, maxTextBytes });
  return buildSummary(collected);
};
