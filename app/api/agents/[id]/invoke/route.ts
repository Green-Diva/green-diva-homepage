// POST /api/agents/[id]/invoke — admin-only async invocation entrypoint.
// Creates an AgentJob row, fires runAgentJob in the background (no await),
// and returns 201 with the jobId. Clients poll GET /jobs/[jobId] to track
// status. Long-running runtimes (LLM tool-use loops in Phase 4) won't hit
// HTTP timeout because the response returns immediately after job creation.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { agentInvokeSchema } from "@/lib/validators";
import { AuthError, requireAdmin } from "@/lib/auth";
import { respondError, respondAuthError, respondValidationError } from "@/lib/api-error";
import { ensureServerInit } from "@/lib/server-init";
import { runAgentJob } from "@/lib/skills/runtime/runner";
import { Prisma } from "@prisma/client";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }

  await ensureServerInit();

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = agentInvokeSchema.safeParse(body);
  if (!parsed.success) {
    return respondValidationError(parsed.error.flatten());
  }

  const agent = await prisma.agent.findUnique({ where: { id }, select: { id: true, mode: true } });
  if (!agent) return respondError("NOT_FOUND", "agent not found", 404);

  let job;
  try {
    job = await prisma.agentJob.create({
      data: {
        agentId: agent.id,
        mode: agent.mode,
        input: (parsed.data.input ?? null) as Prisma.InputJsonValue,
        status: "PENDING",
      },
      select: { id: true, status: true, createdAt: true },
    });
  } catch (e) {
    console.error("[api/agents/invoke] create job failed", e);
    return respondError("INVOKE_FAILED", "invoke failed", 500);
  }

  // Fire-and-forget. Runner has its own try/catch and writes terminal
  // status into the AgentJob row on completion or error.
  void runAgentJob(job.id);

  return NextResponse.json({ jobId: job.id, status: job.status, createdAt: job.createdAt }, { status: 201 });
}
