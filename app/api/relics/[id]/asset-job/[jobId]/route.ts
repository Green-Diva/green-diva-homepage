// GET /api/relics/[id]/asset-job/[jobId] — polling endpoint for the
// admin-initiated "2D 增强" / "3D 立体" buttons on the detail page.
//
// Returns AgentJob status + output. The runner's writeback hook
// (lib/skills/runtime/runner.ts::maybeWriteRelicAsset) updates the Relic
// row on success, so once status=SUCCESS the frontend can router.refresh()
// to pick up the new enhancedImagePath / modelPath via SSR.
//
// Auth: requires the same access as the relic itself (admin or unlocked
// viewer). The job is verified to belong to the scribe agent invoked from
// this relic — no cross-relic leakage.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ADMIN_LEVEL, getCurrentUser } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";

type Ctx = { params: Promise<{ id: string; jobId: string }> };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id, jobId } = await params;

  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, slug: true, rarity: true },
  });
  if (!relic) return NextResponse.json({ error: "relic not found" }, { status: 404 });

  const [user, unlockedIds] = await Promise.all([getCurrentUser(), getUnlockedRelicIds()]);
  if (canAccessRelic(relic, user, unlockedIds).level === "RED") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const isAdmin = (user?.level ?? 0) >= ADMIN_LEVEL;

  const job = await prisma.agentJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      agentId: true,
      status: true,
      input: true,
      output: true,
      runLog: true,
      errorCode: true,
      errorMessage: true,
      startedAt: true,
      finishedAt: true,
      attempts: true,
      maxAttempts: true,
    },
  });
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

  // Defense: refuse if the job's input doesn't carry _relicId matching the
  // URL. Prevents jobId-guessing across relics.
  const jobRelicId = isObject(job.input) ? (job.input as Record<string, unknown>)._relicId : null;
  if (jobRelicId !== id) {
    return NextResponse.json({ error: "job not bound to this relic" }, { status: 403 });
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    mode: isObject(job.input) ? (job.input as Record<string, unknown>).mode : null,
    output: isAdmin ? job.output : null,
    runLog: isAdmin ? job.runLog : null,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
  });
}
