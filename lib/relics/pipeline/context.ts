import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { Agent, Relic, RelicProcessingJob } from "@prisma/client";
import { RELIC_STORAGE_ROOT } from "@/lib/relicStorage";

export type PipelineDirs = {
  /** Absolute path to the relic's root storage directory. */
  root: string;
  /** Absolute path to source/ — original ZIP + extracted/ tree. */
  source: string;
  /** Absolute path to source/extracted/ — exploded ZIP contents. */
  extracted: string;
  /** Absolute path to derived/ — pipeline outputs (clean photos, GLB, metadata, derived ZIP). */
  derived: string;
};

export type PipelineContext = {
  job: RelicProcessingJob;
  relic: Relic;
  agent: Agent;
  dirs: PipelineDirs;
  /** Mutable map of step.id -> arbitrary result data shared with downstream steps. */
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

export async function ensurePipelineDirs(dirs: PipelineDirs): Promise<void> {
  await fs.mkdir(dirs.root, { recursive: true });
  await fs.mkdir(dirs.source, { recursive: true });
  await fs.mkdir(dirs.derived, { recursive: true });
}
