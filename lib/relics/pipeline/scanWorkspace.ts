// scanWorkspace — relic pipeline helper (pure IO, no LLM/AI).
//
// Collects everything the Lore Forge needs as *context* before we hand off
// to the agent layer:
//   - userBrief   : admin's free-text note from RelicDraft.draftNote / Relic.draftNote
//   - fileSummary : formatted listing of files in source/extracted/
//   - imageAbsPaths: absolute paths to image files (capped at 8, for vision skills)
//   - textExcerpts : concatenated heads of text files (for LLM context)
//
// This replaces the relic-files-summary INTERNAL skill — that handler was
// doing pipeline work (FS scan + Prisma query) inside the agent DAG, which
// violated the boundary: the pipeline should prepare context, the agent
// should consume it.
//
// Called by runScribeForWorkspace before callScene so the agent receives
// ready-made data rather than reaching back into the relic filesystem.

import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db";
import { pipelineDirsForSlug } from "./context";

const TEXT_EXTS = new Set([".txt", ".md", ".json", ".csv", ".log"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".gif"]);
const SAFE_SLUG_RE = /^(_drafts\/)?[a-zA-Z0-9_-]+$/;
const DRAFT_PREFIX = "_drafts/";

const MAX_FILES = 50;
const MAX_TEXT_BYTES = 8192;
const MAX_IMAGE_PATHS = 8;

export type WorkspaceScan = {
  userBrief: string;
  fileSummary: string;
  imageAbsPaths: string[];
  textExcerpts: string;
};

function isSidecar(p: string): boolean {
  const base = path.basename(p);
  return base.startsWith("._") || base === ".DS_Store" || base === "Thumbs.db";
}

async function listFiles(
  rootAbs: string,
): Promise<Array<{ relPath: string; absPath: string; sizeBytes: number }>> {
  const out: Array<{ relPath: string; absPath: string; sizeBytes: number }> = [];
  async function walk(dir: string): Promise<void> {
    if (out.length >= MAX_FILES) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (out.length >= MAX_FILES) break;
      if (isSidecar(ent.name)) continue;
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

async function readHead(abs: string): Promise<string> {
  try {
    const handle = await fs.open(abs, "r");
    try {
      const buf = Buffer.alloc(MAX_TEXT_BYTES);
      const { bytesRead } = await handle.read(buf, 0, MAX_TEXT_BYTES, 0);
      return buf.subarray(0, bytesRead).toString("utf8").trim();
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

async function fetchUserBrief(workspaceSlug: string): Promise<string> {
  if (workspaceSlug.startsWith(DRAFT_PREFIX)) {
    const draftId = workspaceSlug.slice(DRAFT_PREFIX.length);
    const draft = await prisma.relicDraft.findUnique({
      where: { id: draftId },
      select: { draftNote: true },
    });
    return (draft?.draftNote ?? "").trim();
  }
  const relic = await prisma.relic.findUnique({
    where: { slug: workspaceSlug },
    select: { draftNote: true },
  });
  return (relic?.draftNote ?? "").trim();
}

export async function scanWorkspace(workspaceSlug: string): Promise<WorkspaceScan> {
  if (!SAFE_SLUG_RE.test(workspaceSlug)) {
    return { userBrief: "", fileSummary: "", imageAbsPaths: [], textExcerpts: "" };
  }

  const [userBrief, entries] = await Promise.all([
    fetchUserBrief(workspaceSlug),
    listFiles(pipelineDirsForSlug(workspaceSlug).extracted),
  ]);

  type FileEntry = {
    relPath: string;
    absPath: string;
    sizeBytes: number;
    kind: "image" | "text" | "other";
    excerpt?: string;
  };

  const files: FileEntry[] = [];
  for (const e of entries) {
    const ext = path.extname(e.relPath).toLowerCase();
    if (IMAGE_EXTS.has(ext)) {
      files.push({ ...e, kind: "image" });
    } else if (TEXT_EXTS.has(ext) && e.sizeBytes > 0) {
      const excerpt = await readHead(e.absPath);
      files.push({ ...e, kind: "text", excerpt });
    } else {
      files.push({ ...e, kind: "other" });
    }
  }

  const imageFiles = files.filter((f) => f.kind === "image");
  const textFiles = files.filter((f) => f.kind === "text");
  const imageAbsPaths = imageFiles.slice(0, MAX_IMAGE_PATHS).map((f) => f.absPath);

  // fileSummary: concise listing for LLM context (same shape as old relic-files-summary)
  const summaryLines: string[] = [
    `Total files: ${files.length} (images: ${imageFiles.length}, text: ${textFiles.length}, other: ${files.filter((f) => f.kind === "other").length})`,
  ];
  if (files.length > 0) {
    summaryLines.push("", "File listing:");
    for (const f of files.slice(0, 30)) {
      summaryLines.push(`  - ${f.relPath} (${formatSize(f.sizeBytes)}, ${f.kind})`);
    }
    if (files.length > 30) summaryLines.push(`  ...and ${files.length - 30} more`);
  }

  // textExcerpts: separate field so loreEn userTemplate can reference it explicitly
  const excerptLines: string[] = [];
  for (const tf of textFiles.slice(0, 5)) {
    const excerpt = (tf.excerpt ?? "").slice(0, 600);
    if (!excerpt) continue;
    excerptLines.push(`--- ${tf.relPath} ---`, excerpt);
  }

  return {
    userBrief,
    fileSummary: summaryLines.join("\n"),
    imageAbsPaths,
    textExcerpts: excerptLines.join("\n"),
  };
}
