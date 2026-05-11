// GET /api/relics/[id]/active-jobs — admin-only, returns the latest
// enhance2d / create3d AgentJob for this relic so the detail page can
// restore "running" / "error" UI after a refresh.
//
// Job state previously lived only in AssetTabs React state; closing the
// tab lost the jobId and the in-flight run looked idle on return. This
// endpoint surfaces server-side truth.
//
// Returns: { enhance: JobSummary | null, model: JobSummary | null }
//   - latest job per sceneKey is returned regardless of status
//   - frontend ignores SUCCESS (covered by Relic.enhancedImagePath / modelPath)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ADMIN_LEVEL, getCurrentUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

const SCENE_KEYS = ["relic.enhance2d", "relic.create3d"] as const;
type SceneKey = (typeof SCENE_KEYS)[number];

type JobSummary = {
  jobId: string;
  status: string;
  errorMessage: string | null;
  startedAt: string | null;
};

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user || user.level < ADMIN_LEVEL) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const relic = await prisma.relic.findUnique({ where: { id }, select: { id: true } });
  if (!relic) return NextResponse.json({ error: "relic not found" }, { status: 404 });

  // Postgres JSON path query: input->>'_relicId' = id. Filter by sceneKey
  // and take the latest per scene via a single query + JS reduce (small
  // result set; no need for DISTINCT ON).
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      sceneKey: string;
      status: string;
      errorMessage: string | null;
      startedAt: Date | null;
      createdAt: Date;
    }>
  >`
    SELECT id, "sceneKey", status::text AS status, "errorMessage", "startedAt", "createdAt"
    FROM "AgentJob"
    WHERE "sceneKey" IN ('relic.enhance2d', 'relic.create3d')
      AND input->>'_relicId' = ${id}
    ORDER BY "createdAt" DESC
  `;

  const latest: Record<SceneKey, JobSummary | null> = {
    "relic.enhance2d": null,
    "relic.create3d": null,
  };
  for (const r of rows) {
    const key = r.sceneKey as SceneKey;
    if (latest[key]) continue; // rows are DESC, first hit wins
    latest[key] = {
      jobId: r.id,
      status: r.status,
      errorMessage: r.errorMessage,
      startedAt: r.startedAt?.toISOString() ?? null,
    };
  }

  return NextResponse.json({
    enhance: latest["relic.enhance2d"],
    model: latest["relic.create3d"],
  });
}
