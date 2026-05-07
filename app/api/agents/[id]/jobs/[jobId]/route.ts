// GET /api/agents/[id]/jobs/[jobId] — single job detail with full input/output/runLog.
// Used by AgentJobDrawer's expand-row view + 3s polling for in-flight jobs.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string; jobId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id, jobId } = await params;

  const job = await prisma.agentJob.findUnique({ where: { id: jobId } });
  if (!job || job.agentId !== id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json(job);
}
