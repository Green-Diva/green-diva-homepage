// POST /api/agents/[id]/dry-run — synchronous executor for editor "Test Run".
// admin-only.
//
// Differences from /invoke:
//   - Synchronous: caller awaits the AgentRunResult inline (no jobId, no row)
//   - Accepts an optional pipelineConfig override so BackboneEditor can test
//     unsaved configs before committing them to the DB
//   - No retry, no transient backoff — just one shot
//
// Production traffic (real invocations from the agent control UI) goes through
// /invoke + AgentJob. Dry-run is purely an editor convenience.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { pipelineConfigSchema, dispatcherConfigSchema } from "@/lib/validators";
import { AuthError, requireAdmin } from "@/lib/auth";
import { invokeAgent } from "@/lib/agents/invoke";

type Ctx = { params: Promise<{ id: string }> };

const dryRunSchema = z.object({
  input: z.unknown(),
  // Optional overrides. Absent → runtime reads from DB column. Null is
  // meaningful (test "what happens with empty config"), so we distinguish
  // absent (use DB) from null (override DB with empty).
  pipelineConfig: pipelineConfigSchema.optional(),
  dispatcherConfig: dispatcherConfigSchema.optional(),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = dryRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: "agent not found" }, { status: 404 });

  const startedAt = Date.now();
  let result;
  try {
    result = await invokeAgent({
      agent,
      mode: agent.mode,
      input: parsed.data.input ?? null,
      pipelineConfigOverride: "pipelineConfig" in parsed.data ? parsed.data.pipelineConfig : undefined,
      dispatcherConfigOverride: "dispatcherConfig" in parsed.data ? parsed.data.dispatcherConfig : undefined,
    });
  } catch (e) {
    console.error("[api/agents/dry-run] dispatcher threw", e);
    return NextResponse.json(
      {
        ok: false,
        errorCode: "AGENT_RUNTIME_ERROR",
        errorMessage: e instanceof Error ? e.message : "dispatcher crashed",
        runLog: [],
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ...result, durationMs: Date.now() - startedAt });
}
