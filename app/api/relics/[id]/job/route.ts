import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ADMIN_LEVEL, getCurrentUser } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { ensureServerInit } from "@/lib/server-init";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureServerInit();
  const { id } = await ctx.params;

  const relic = await prisma.relic.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      slot: true,
      rarity: true,
      passwordHash: true,
      extractedAt: true,
      status: true,
    },
  });
  if (!relic) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [user, unlockedIds] = await Promise.all([getCurrentUser(), getUnlockedRelicIds()]);
  const access = canAccessRelic(relic, user, unlockedIds);
  if (access.level === "RED") {
    return NextResponse.json({ error: "locked" }, { status: 403 });
  }

  const job = await prisma.relicProcessingJob.findFirst({
    where: { relicId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      step: true,
      progress: true,
      attempt: true,
      maxAttempts: true,
      errorMessage: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
      stepResults: true,
    },
  });

  if (!job) {
    return NextResponse.json({
      hasJob: false,
      relicStatus: relic.status,
    });
  }

  const isAdmin = !!user && user.level >= ADMIN_LEVEL;
  const payload = {
    hasJob: true,
    relicStatus: relic.status,
    job: {
      id: job.id,
      status: job.status,
      step: job.step,
      progress: job.progress,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      errorMessage: job.errorMessage,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      createdAt: job.createdAt,
      ...(isAdmin ? { stepResults: job.stepResults } : {}),
    },
  };
  return NextResponse.json(payload);
}
