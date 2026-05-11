// POST /api/agents/[id]/jobs/[jobId]/retry — admin-only re-run of a FAILED job.
// Resets terminal state (status, output, error*, finishedAt) but preserves the
// original input and the prior attempts counter so the runner's retry budget
// still applies.
//
// Refusing to retry SUCCESS jobs is intentional — re-running a successful
// invocation could double-charge an upstream API. If admin really wants
// to re-do a successful one, they should fire a fresh /invoke instead.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { respondError, respondAuthError } from "@/lib/api-error";
import { ensureServerInit } from "@/lib/server-init";
import { runAgentJob } from "@/lib/skills/runtime/runner";
import { Prisma } from "@prisma/client";

type Ctx = { params: Promise<{ id: string; jobId: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }
  await ensureServerInit();

  const { id, jobId } = await params;
  const job = await prisma.agentJob.findUnique({
    where: { id: jobId },
    select: { id: true, agentId: true, status: true },
  });
  if (!job || job.agentId !== id) {
    return respondError("NOT_FOUND", "not found", 404);
  }
  if (job.status === "SUCCESS") {
    return respondError("JOB_NOT_RETRYABLE", "cannot retry a successful job; create a new invocation instead", 409);
  }
  if (job.status === "PENDING" || job.status === "RUNNING") {
    return respondError("JOB_IN_FLIGHT", "job already in flight", 409);
  }

  try {
    await prisma.agentJob.update({
      where: { id: jobId },
      data: {
        status: "PENDING",
        output: Prisma.JsonNull,
        errorCode: null,
        errorMessage: null,
        // Null both timestamps so runner sets startedAt=now on the next run
        // and duration reflects only this attempt (not wall-clock from
        // the original invocation). attempts counter is preserved so the
        // transient-retry budget still applies.
        startedAt: null,
        finishedAt: null,
      },
    });
  } catch (e) {
    console.error("[api/agents/jobs/retry] reset failed", e);
    return respondError("RETRY_FAILED", "retry failed", 500);
  }

  void runAgentJob(jobId);

  return NextResponse.json({ jobId, status: "PENDING" });
}
