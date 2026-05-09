import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { Relic, RelicProcessingJob } from "@prisma/client";
import { RELIC_STORAGE_ROOT } from "@/lib/relicStorage";

export type PipelineDirs = {
  root: string;
  source: string;
  extracted: string;
  derived: string;
};

export type PipelineContext = {
  job: RelicProcessingJob;
  relic: Relic;
  dirs: PipelineDirs;
  results: Map<string, unknown>;
};

export type StepResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export function pipelineDirsForSlug(slug: string): PipelineDirs {
  const root = path.join(RELIC_STORAGE_ROOT, slug);
  return {
    root,
    source: path.join(root, "source"),
    extracted: path.join(root, "source", "extracted"),
    derived: path.join(root, "derived"),
  };
}

// Drafts live under private/relics/_drafts/<draftId>/. The leading underscore
// distinguishes them from real relic slugs (which all start with "vault-")
// and keeps them out of public asset routing. On confirm the directory is
// renamed in place to <finalSlug>/.
export const DRAFT_DIR_PREFIX = "_drafts";

export function draftWorkspaceSlug(draftId: string): string {
  return `${DRAFT_DIR_PREFIX}/${draftId}`;
}

export function pipelineDirsForDraft(draftId: string): PipelineDirs {
  return pipelineDirsForSlug(draftWorkspaceSlug(draftId));
}

export async function ensurePipelineDirs(dirs: PipelineDirs): Promise<void> {
  await fs.mkdir(dirs.root, { recursive: true });
  await fs.mkdir(dirs.source, { recursive: true });
  await fs.mkdir(dirs.derived, { recursive: true });
}
