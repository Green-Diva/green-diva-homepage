// POST /api/relics/[id]/enhance-2d — admin-only, async via AgentJob.
//
// Triggers the relic scribe agent in `mode: "2dEnhance"`. Input carries
// `relicSlug + imagePath` (the relic's primaryImagePath) so the cutout
// node can read the source image without an extra DB hop. The runner's
// writeback hook (lib/skills/runtime/runner.ts::maybeWriteRelicAsset)
// updates Relic.enhancedImagePath on success.
//
// Returns `{ jobId }` immediately. Frontend polls
// /api/relics/[id]/asset-job/[jobId] every 3s.

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { runAgentJob } from "@/lib/skills/runtime/runner";

const SCRIBE_CODENAME = "RELIC-SCRIBE-001";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { id } = await params;
  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, slug: true, primaryImagePath: true, enhancedImagePath: true },
  });
  if (!relic) return NextResponse.json({ error: "relic not found" }, { status: 404 });
  if (!relic.primaryImagePath) {
    return NextResponse.json(
      { error: "relic has no primaryImagePath to enhance" },
      { status: 409 },
    );
  }

  const agent = await prisma.agent.findUnique({
    where: { codename: SCRIBE_CODENAME },
    select: { id: true, mode: true, deployedAt: true },
  });
  if (!agent) return NextResponse.json({ error: "scribe agent missing" }, { status: 503 });
  if (!agent.deployedAt) {
    return NextResponse.json({ error: "scribe agent not deployed" }, { status: 503 });
  }

  const input = {
    mode: "2dEnhance" as const,
    relicSlug: relic.slug,
    imagePath: relic.primaryImagePath,
    _relicId: relic.id,
  };

  let job;
  try {
    job = await prisma.agentJob.create({
      data: {
        agentId: agent.id,
        mode: agent.mode,
        input: input as unknown as Prisma.InputJsonValue,
        status: "PENDING",
      },
      select: { id: true, status: true, createdAt: true },
    });
  } catch (e) {
    console.error("[api/relics/enhance-2d] create job failed", e);
    return NextResponse.json({ error: "enqueue failed" }, { status: 500 });
  }

  void runAgentJob(job.id);

  return NextResponse.json(
    { jobId: job.id, agentId: agent.id, status: job.status, createdAt: job.createdAt },
    { status: 201 },
  );
}
