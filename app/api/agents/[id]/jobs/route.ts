// GET /api/agents/[id]/jobs — list recent invocation history for an agent.
// requireUser (anyone logged in can view; jobs don't expose secrets — input
// and runLog only contain caller-supplied values and skill outputs that
// already passed schema validation).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

const PAGE_SIZE = 50;

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;

  const agent = await prisma.agent.findUnique({ where: { id }, select: { id: true } });
  if (!agent) return NextResponse.json({ error: "agent not found" }, { status: 404 });

  const jobs = await prisma.agentJob.findMany({
    where: { agentId: id },
    orderBy: [{ createdAt: "desc" }],
    take: PAGE_SIZE,
    // Omit input/output/runLog from list view — fetch on detail page.
    // Keeps history responses small even with 50+ jobs over time.
    select: {
      id: true,
      mode: true,
      status: true,
      errorCode: true,
      errorMessage: true,
      attempts: true,
      maxAttempts: true,
      startedAt: true,
      endedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(jobs);
}
