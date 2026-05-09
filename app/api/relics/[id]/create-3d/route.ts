// POST /api/relics/[id]/create-3d — admin-only, async via AgentJob.
//
// Hard precondition: Relic.enhancedImagePath must be set (i.e. 2D 增强 has
// already run). Meshy gets the transparent PNG, not the original snapshot,
// so 3D quality stays high. 409 if precondition fails.
//
// Triggers the relic scribe agent in `mode: "3dCreate"`. Returns `{ jobId }`;
// frontend polls /api/relics/[id]/asset-job/[jobId]. Runner's writeback hook
// fills Relic.modelPath on success.

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
    select: { id: true, slug: true, enhancedImagePath: true, modelPath: true },
  });
  if (!relic) return NextResponse.json({ error: "relic not found" }, { status: 404 });
  if (!relic.enhancedImagePath) {
    return NextResponse.json(
      { error: "需要先完成 2D 增强 (Relic.enhancedImagePath is null)" },
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
    mode: "3dCreate" as const,
    relicSlug: relic.slug,
    imagePath: relic.enhancedImagePath, // transparent PNG → cleaner 3D
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
    console.error("[api/relics/create-3d] create job failed", e);
    return NextResponse.json({ error: "enqueue failed" }, { status: 500 });
  }

  void runAgentJob(job.id);

  return NextResponse.json(
    { jobId: job.id, agentId: agent.id, status: job.status, createdAt: job.createdAt },
    { status: 201 },
  );
}
