// POST /api/relics/[id]/enhance-2d — admin-only, async via SceneBinding.
//
// Two call shapes:
//   • Legacy single (no items[]):  enhances Relic.primaryImagePath →
//     dispatchScene once, returns { jobId, agentId, status, createdAt }.
//     Detail-page direct "生成" button still uses this path.
//   • Batch (items: [{candidatePath}, ...], max 16): enhances each picked
//     candidate independently. Returns { jobs: [{candidatePath, jobId,
//     agentId, status}, ...] }. The new Cutout2dConfigModal uses this.
//
// Each job dispatches relic.enhance2d separately so failures are isolated
// and frontend polls each jobId. Runner's writeback upserts each output
// into Relic.enhancedImages keyed on sourceCandidatePath (same source
// re-enhanced overwrites its previous entry; cap 16).
//
// model / operatingResolution / refineForeground are top-level (shared by
// every job in a batch). 2304 + non-Dynamic is rejected up front.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { recordRelicLog } from "@/lib/relicLog";
import { dispatchScene, SceneError } from "@/lib/agent-service";
import { readRelicImageAsDataUri, ReadImageError } from "@/lib/relics/readImageAsDataUri";

const Body = z
  .object({
    model: z
      .enum([
        "General Use (Light)",
        "General Use (Light 2K)",
        "General Use (Heavy)",
        "Matting",
        "Portrait",
        "General Use (Dynamic)",
      ])
      .optional(),
    operatingResolution: z.enum(["1024x1024", "2048x2048", "2304x2304"]).optional(),
    refineForeground: z.boolean().optional(),
    items: z
      .array(z.object({ candidatePath: z.string().min(1) }).strict())
      .min(1)
      .max(16)
      .optional(),
  })
  .strict();

type CandidateEntry = {
  path?: string;
  source?: string;
  deleted?: boolean;
};

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let opts: z.infer<typeof Body> = {};
  try {
    const raw = await req.json();
    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid options: " + parsed.error.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    }
    opts = parsed.data;
  } catch {
    // empty / non-JSON body → use scene defaults, treat as legacy single
  }
  if (opts.operatingResolution === "2304x2304" && opts.model && opts.model !== "General Use (Dynamic)") {
    return NextResponse.json(
      { error: "2304x2304 resolution requires the Dynamic model" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const relic = await prisma.relic.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      nameEn: true,
      primaryImagePath: true,
      candidateImages: true,
    },
  });
  if (!relic) return NextResponse.json({ error: "relic not found" }, { status: 404 });

  // Resolve which candidate paths to enhance.
  let targetPaths: string[];
  if (opts.items && opts.items.length > 0) {
    // Batch: validate each requested candidatePath is in the relic's
    // candidate set + non-deleted. Reject the whole batch if any is invalid.
    const candidates: CandidateEntry[] = Array.isArray(relic.candidateImages)
      ? (relic.candidateImages as CandidateEntry[])
      : [];
    const validPaths = new Set(
      candidates
        .filter((c) => c.deleted !== true && typeof c.path === "string")
        .map((c) => c.path as string),
    );
    for (const it of opts.items) {
      if (!validPaths.has(it.candidatePath)) {
        return NextResponse.json(
          { error: `candidatePath not in relic's non-deleted candidates: ${it.candidatePath}` },
          { status: 400 },
        );
      }
    }
    // Dedupe (same path picked twice in one batch is wasteful, not wrong).
    targetPaths = Array.from(new Set(opts.items.map((it) => it.candidatePath)));
  } else {
    // Legacy single-source path: enhance the primary.
    if (!relic.primaryImagePath) {
      return NextResponse.json(
        { error: "relic has no primaryImagePath to enhance" },
        { status: 409 },
      );
    }
    targetPaths = [relic.primaryImagePath];
  }

  // Dispatch one scene per target. Per-item errors are reported in the
  // response (legacy single path bubbles them as the top-level error).
  type JobOk = {
    candidatePath: string;
    jobId: string;
    agentId: string;
    status: string;
    createdAt: string;
  };
  type JobErr = { candidatePath: string; error: string; status: "FAILED" };
  const jobs: Array<JobOk | JobErr> = [];

  for (const candidatePath of targetPaths) {
    // Per-item read: each candidate could be a different file.
    let imageDataUri: string;
    try {
      const enc = await readRelicImageAsDataUri(candidatePath);
      imageDataUri = enc.dataUri;
    } catch (e) {
      const msg =
        e instanceof ReadImageError ? `image read failed: ${e.message}` : "image read failed";
      jobs.push({ candidatePath, error: msg, status: "FAILED" });
      continue;
    }

    try {
      const dispatch = await dispatchScene(
        "relic.enhance2d",
        {
          relicId: relic.id,
          relicSlug: relic.slug,
          imageDataUri,
          sourceCandidatePath: candidatePath,
          ...(opts.model ? { model: opts.model } : {}),
          ...(opts.operatingResolution ? { operatingResolution: opts.operatingResolution } : {}),
          ...(opts.refineForeground !== undefined ? { refineForeground: opts.refineForeground } : {}),
        },
        { actor: { userId: me.id, level: me.level, name: me.name } },
      );
      jobs.push({
        candidatePath,
        jobId: dispatch.jobId,
        agentId: dispatch.agentId,
        status: dispatch.status,
        createdAt:
          dispatch.createdAt instanceof Date
            ? dispatch.createdAt.toISOString()
            : String(dispatch.createdAt),
      });
      await recordRelicLog({
        action: "PROCESSING_STARTED",
        relic: { id: relic.id, slug: relic.slug, name: relic.nameEn || relic.slug },
        actor: { id: me.id, name: me.name },
        details: { phase: "enhance2d", jobId: dispatch.jobId, sourceCandidatePath: candidatePath },
      });
    } catch (e) {
      const msg =
        e instanceof SceneError ? e.message : "enqueue failed";
      if (!(e instanceof SceneError)) {
        console.error("[api/relics/enhance-2d] dispatch failed", e);
      }
      jobs.push({ candidatePath, error: msg, status: "FAILED" });
    }
  }

  // Back-compat: legacy single-path callers expect the flat envelope.
  if (!opts.items) {
    const j = jobs[0];
    if ("error" in j) {
      return NextResponse.json({ error: j.error }, { status: 500 });
    }
    return NextResponse.json(
      {
        jobId: j.jobId,
        agentId: j.agentId,
        status: j.status,
        createdAt: j.createdAt,
      },
      { status: 201 },
    );
  }

  return NextResponse.json({ jobs }, { status: 201 });
}
