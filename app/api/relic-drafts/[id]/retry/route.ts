// Retry a failed draft pipeline. fromStep param picks where to resume —
// EXTRACT_ZIP starts over (rare), GENERATE_METADATA reuses the extracted
// files. Mirrors /api/relics/[id]/jobs/[jobId]/retry for the legacy path.

import { NextRequest, NextResponse } from "next/server";
import type { RelicJobStep } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { runDraftPipeline } from "@/lib/relics/pipeline/draft/runner";

const VALID_STEPS = new Set<RelicJobStep>(["EXTRACT_ZIP", "GENERATE_METADATA"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const url = new URL(req.url);
  const fromStepRaw = url.searchParams.get("fromStep") ?? "GENERATE_METADATA";

  if (!VALID_STEPS.has(fromStepRaw as RelicJobStep)) {
    return NextResponse.json({ error: `invalid fromStep: ${fromStepRaw}` }, { status: 400 });
  }
  const fromStep = fromStepRaw as Extract<RelicJobStep, "EXTRACT_ZIP" | "GENERATE_METADATA">;

  const draft = await prisma.relicDraft.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (draft.status === "RUNNING") {
    return NextResponse.json({ error: "draft is already running" }, { status: 409 });
  }
  if (draft.status === "CANCELLED") {
    return NextResponse.json({ error: "draft was cancelled" }, { status: 409 });
  }

  await prisma.relicDraft.update({
    where: { id },
    data: { status: "PENDING", errorMessage: null, attempt: 0 },
  });

  void runDraftPipeline(id, { fromStep }).catch((e) => {
    console.error("[api/relic-drafts/retry] kickoff threw", { id, e });
  });

  return NextResponse.json({ ok: true, fromStep });
}
