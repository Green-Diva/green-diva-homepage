// GET /api/agent-jobs — list endpoint for the Activity tab. Filters on
// sceneKey / agentId / status / sinceMs and returns the most recent N
// jobs (default 50, max 200).
//
// Auth: admin-only — Activity reveals everyone's invocations including
// caller identity, so it stays scoped to admins same as the rest of
// /agent-control.

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const VALID_STATUS = new Set(["PENDING", "RUNNING", "SUCCESS", "FAILED"]);

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const url = req.nextUrl;
  const sceneKey = url.searchParams.get("sceneKey");
  const agentId = url.searchParams.get("agentId");
  const status = url.searchParams.get("status");
  const sinceMsRaw = url.searchParams.get("sinceMs");
  const limitRaw = url.searchParams.get("limit");

  const limit = (() => {
    const n = limitRaw ? Number(limitRaw) : DEFAULT_LIMIT;
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
    return Math.min(MAX_LIMIT, Math.floor(n));
  })();

  const where: Prisma.AgentJobWhereInput = {};
  if (sceneKey) where.sceneKey = sceneKey;
  if (agentId) where.agentId = agentId;
  if (status && VALID_STATUS.has(status)) {
    where.status = status as Prisma.AgentJobWhereInput["status"];
  }
  if (sinceMsRaw) {
    const ms = Number(sinceMsRaw);
    if (Number.isFinite(ms) && ms > 0) {
      where.createdAt = { gte: new Date(Date.now() - ms) };
    }
  }

  const rows = await prisma.agentJob.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      agentId: true,
      mode: true,
      status: true,
      errorCode: true,
      errorMessage: true,
      sceneKey: true,
      actorUserId: true,
      actorName: true,
      routedTo: true,
      attempts: true,
      startedAt: true,
      endedAt: true,
      createdAt: true,
      // Skip input/output/runLog from the list view — they're heavy and
      // the row drawer fetches /api/agent-jobs/[jobId] for the full
      // record when expanded.
      agent: { select: { codename: true, mode: true } },
    },
  });

  // Surface scene options + agent options the UI uses to populate
  // dropdowns. Cheaper to compute here than to make the client do two
  // extra round trips.
  const [sceneRows, agentRows] = await Promise.all([
    prisma.sceneBinding.findMany({
      orderBy: { sceneKey: "asc" },
      select: { sceneKey: true },
    }),
    prisma.agent.findMany({
      orderBy: { codename: "asc" },
      select: { id: true, codename: true },
    }),
  ]);

  return NextResponse.json({
    rows,
    filterOptions: {
      scenes: sceneRows.map((s) => s.sceneKey),
      agents: agentRows,
      statuses: Array.from(VALID_STATUS),
    },
    meta: { limit, returned: rows.length },
  });
}
