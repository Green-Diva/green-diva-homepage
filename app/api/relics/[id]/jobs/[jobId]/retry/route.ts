import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { recordRelicLog } from "@/lib/relicLog";
import { runRelicPipeline } from "@/lib/relics/pipeline";
import { ensureServerInit } from "@/lib/server-init";

const fromStepSchema = z
  .enum([
    "ENQUEUED",
    "EXTRACT_ZIP",
    "REMOVE_BG",
    "STRUCTURED_FIELDS",
    "GEN_3D",
    "WEB_RESEARCH",
    "WRITE_LORE",
    "PACK_DERIVED",
    "FINALIZE",
  ])
  .optional();

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; jobId: string }> },
) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
  await ensureServerInit();

  const { id, jobId } = await ctx.params;
  const url = new URL(req.url);
  const parsed = fromStepSchema.safeParse(url.searchParams.get("fromStep") ?? undefined);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid fromStep" }, { status: 400 });
  }
  const fromStep = parsed.data;

  const job = await prisma.relicProcessingJob.findUnique({
    where: { id: jobId },
    include: { relic: true },
  });
  if (!job || job.relicId !== id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (job.status === "RUNNING") {
    return NextResponse.json({ error: "job is currently running" }, { status: 409 });
  }

  await prisma.relicProcessingJob.update({
    where: { id: jobId },
    data: {
      status: "PENDING",
      step: fromStep ?? "ENQUEUED",
      errorMessage: null,
    },
  });
  await recordRelicLog({
    action: "PROCESSING_STARTED",
    relic: { id: job.relic.id, slug: job.relic.slug, name: job.relic.nameEn || job.relic.slug },
    actor: { id: me.id, name: me.name },
    details: { jobId, retried: true, fromStep: fromStep ?? null },
  });

  void runRelicPipeline(jobId, fromStep ? { fromStep } : undefined).catch((e) => {
    console.error("[api/retry] pipeline kickoff threw", { jobId, e });
  });

  return NextResponse.json({ ok: true, jobId, fromStep: fromStep ?? "ENQUEUED" });
}
