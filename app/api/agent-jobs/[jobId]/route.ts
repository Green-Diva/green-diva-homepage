// GET /api/agent-jobs/[jobId] — generic AgentJob status endpoint.
//
// Every site module that uses dispatchScene gets its job status from
// here, regardless of which agent/scene was invoked. Replaces the
// per-agent /api/agents/[id]/jobs/[jobId] for callers that don't know
// (or care) which agent satisfies a scene.
//
// Auth: admin-only for Phase 0a. Phase 5 may broaden to "the actor whose
// _actor.userId matches the current user, OR admin" once non-admin
// modules start using dispatchScene.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";

type Ctx = { params: Promise<{ jobId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { jobId } = await params;

  const job = await prisma.agentJob.findUnique({
    where: { id: jobId },
    include: {
      agent: {
        select: { id: true, codename: true, mode: true, nameEn: true, nameZh: true },
      },
    },
  });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(job);
}
