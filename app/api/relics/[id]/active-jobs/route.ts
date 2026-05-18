// GET /api/relics/[id]/active-jobs — admin-only, returns recent in-flight
// jobs for this relic so the detail page can restore UI after a refresh.
//
// Enhance is now batchable (1 AgentJob per candidate), so this returns an
// array of recent enhance jobs. Model stays single (one Meshy job per
// click; previously a 1:1 relationship).
//
// Returns: { enhance: JobSummary[], model: JobSummary | null }
//   - enhance: jobs within the last hour (RUNNING / PENDING / FAILED).
//     Frontend filters & polls each.
//   - model: latest job regardless of status; same as before.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ADMIN_LEVEL, getCurrentUser } from "@/lib/auth";
import "@/lib/scenes-init";
import { getScene } from "@/lib/agent-service/registry";

type Ctx = { params: Promise<{ id: string }> };

const SCENE_KEYS = ["relic.enhance2d", "relic.create3d"] as const;
type SceneKey = (typeof SCENE_KEYS)[number];

type JobSummary = {
  jobId: string;
  status: string;
  errorMessage: string | null;
  startedAt: string | null;
  slaMs: number | null;
  progressPercent: number | null;
  progressLabel: string | null;
  sourceCandidatePath: string | null;
};

const ENHANCE_RECENT_MS = 60 * 60 * 1000; // 1 hour

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user || user.level < ADMIN_LEVEL) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const relic = await prisma.relic.findUnique({ where: { id }, select: { id: true } });
  if (!relic) return NextResponse.json({ error: "relic not found" }, { status: 404 });

  type Row = {
    id: string;
    sceneKey: string;
    status: string;
    errorMessage: string | null;
    startedAt: Date | null;
    createdAt: Date;
    progressPercent: number | null;
    progressLabel: string | null;
    input: unknown;
  };

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT id, "sceneKey", status::text AS status, "errorMessage", "startedAt", "createdAt",
           "progressPercent", "progressLabel", input
    FROM "AgentJob"
    WHERE "sceneKey" IN ('relic.enhance2d', 'relic.create3d')
      AND input->>'_relicId' = ${id}
    ORDER BY "createdAt" DESC
  `;

  const sourceOf = (input: unknown): string | null => {
    if (input && typeof input === "object" && !Array.isArray(input)) {
      const v = (input as Record<string, unknown>).sourceCandidatePath;
      return typeof v === "string" ? v : null;
    }
    return null;
  };
  const toSummary = (r: Row, key: SceneKey): JobSummary => ({
    jobId: r.id,
    status: r.status,
    errorMessage: r.errorMessage,
    startedAt: r.startedAt?.toISOString() ?? null,
    slaMs: getScene(key)?.slaMs ?? null,
    progressPercent: r.progressPercent,
    progressLabel: r.progressLabel,
    sourceCandidatePath: sourceOf(r.input),
  });

  // Enhance: keep recent jobs (within 1h) so the carousel + chip can
  // resume after refresh. Older finished jobs aren't relevant — the
  // success state is already reflected in Relic.enhancedImages.
  const cutoff = Date.now() - ENHANCE_RECENT_MS;
  const enhance: JobSummary[] = rows
    .filter(
      (r) =>
        r.sceneKey === "relic.enhance2d" &&
        r.createdAt.getTime() >= cutoff,
    )
    .map((r) => toSummary(r, "relic.enhance2d"));

  // Model: latest only — single-job semantics unchanged.
  let model: JobSummary | null = null;
  for (const r of rows) {
    if (r.sceneKey === "relic.create3d") {
      model = toSummary(r, "relic.create3d");
      break;
    }
  }

  return NextResponse.json({ enhance, model });
}
