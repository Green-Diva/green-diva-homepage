// Manual smoke test of an agent's bound scenes (2026-05-15). Replaces
// the deploy-time test gate. Admin opens the Test Run modal on the
// agent detail header, picks which bound scenes to exercise, and clicks
// run. This endpoint loops over the selected scene keys, parses each
// scene's `sampleCtx` against its contextSchema, runs `executeAgent`,
// and returns per-scene results.
//
// Side effects: skills are invoked for real (fal.ai cutout writes a
// derived/enhanced-*.png, Meshy spawns a paid 3D task, Vision API +
// Gemini calls cost LLM credits). The endpoint guards against silent
// surprise via the modal's explicit "TEST" / "EXPENSIVE" badges; this
// route does not gate further.
//
// Scope: only sceneKeys that this agent owns a live SceneBinding for
// are accepted. Unbound / cross-agent keys are rejected with 400 to
// avoid using the endpoint as a generic agent invoke.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { respondError, respondAuthError } from "@/lib/api-error";
import { getScene } from "@/lib/agent-service";
import "@/lib/scenes-init"; // populate scene registry
import { executeAgent } from "@/lib/agents/invoke";
import { ensureSmokeFixtures } from "@/lib/relics/smokeFixtures";

type Ctx = { params: Promise<{ id: string }> };

const TEST_RUN_TIMEOUT_MS = 20 * 60 * 1000; // 20 min — covers Meshy worst case

export async function POST(req: NextRequest, { params }: Ctx) {
  let actor;
  try {
    actor = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as
    | { sceneKeys?: unknown }
    | null;
  if (!body || !Array.isArray(body.sceneKeys) || body.sceneKeys.length === 0) {
    return respondError(
      "VALIDATION_FAILED",
      "request body must be { sceneKeys: string[] } with at least one key",
      400,
    );
  }
  const sceneKeys = body.sceneKeys.filter(
    (k): k is string => typeof k === "string" && k.length > 0,
  );
  if (sceneKeys.length === 0) {
    return respondError(
      "VALIDATION_FAILED",
      "sceneKeys must contain at least one non-empty string",
      400,
    );
  }
  if (sceneKeys.length > 10) {
    return respondError("VALIDATION_FAILED", "max 10 scenes per test run", 400);
  }

  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return respondError("NOT_FOUND", "agent not found", 404);

  // Scope guard: accept any sceneKey the agent claims (intent) OR owns
  // a live SceneBinding for. This lets admin smoke-test a draft / re-
  // drafted agent before re-deploy — the test calls executeAgent directly
  // (no SceneBinding routing involved), so a claim is enough authority
  // to scope the run.
  const ownBindings = await prisma.sceneBinding.findMany({
    where: { agentId: id, sceneKey: { in: sceneKeys } },
    select: { sceneKey: true },
  });
  const claimSet = new Set<string>([
    ...ownBindings.map((b) => b.sceneKey),
    ...agent.intentSceneKeys,
  ]);
  const unowned = sceneKeys.filter((k) => !claimSet.has(k));
  if (unowned.length > 0) {
    return respondError(
      "AUTH_FORBIDDEN",
      `agent does not claim scene(s): ${unowned.join(", ")}`,
      403,
    );
  }

  // Make fs fixtures (1×1 PNG at /tmp/_smoke-test-ref.png) available for
  // scenes that read from disk. Idempotent.
  try {
    await ensureSmokeFixtures();
  } catch (e) {
    console.warn("[api/agents/test-run] ensureSmokeFixtures failed (continuing)", e);
  }

  const results: Array<{
    sceneKey: string;
    ok: boolean;
    durationMs: number;
    skipped?: boolean;
    reason?: string;
    errorCode?: string;
    errorMessage?: string;
    output?: unknown;
    runLog?: unknown;
  }> = [];

  for (const sceneKey of sceneKeys) {
    const scene = getScene(sceneKey);
    if (!scene) {
      results.push({
        sceneKey,
        ok: false,
        durationMs: 0,
        errorCode: "UNKNOWN_SCENE",
        errorMessage: `scene "${sceneKey}" not registered`,
      });
      continue;
    }
    if (!scene.sampleCtx) {
      results.push({
        sceneKey,
        ok: true,
        durationMs: 0,
        skipped: true,
        reason: "no sampleCtx defined for this scene",
      });
      continue;
    }

    const startedAt = Date.now();
    try {
      const ctxParse = scene.contextSchema.safeParse(scene.sampleCtx);
      if (!ctxParse.success) {
        results.push({
          sceneKey,
          ok: false,
          durationMs: Date.now() - startedAt,
          errorCode: "CONTEXT_INVALID",
          errorMessage: `sampleCtx failed its own contextSchema: ${JSON.stringify(ctxParse.error.flatten())}`,
        });
        continue;
      }
      const agentInput = scene.prepareAgentInput
        ? scene.prepareAgentInput(ctxParse.data, {
            userId: actor.id,
            level: actor.level,
            name: actor.name,
          })
        : ctxParse.data;

      const result = await Promise.race([
        executeAgent({ agent, mode: agent.mode, input: agentInput }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`test-run timeout after ${TEST_RUN_TIMEOUT_MS}ms`)),
            TEST_RUN_TIMEOUT_MS,
          ),
        ),
      ]);
      const durationMs = Date.now() - startedAt;
      if (result.ok) {
        results.push({ sceneKey, ok: true, durationMs, output: result.output, runLog: result.runLog });
      } else {
        results.push({
          sceneKey,
          ok: false,
          durationMs,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
          runLog: result.runLog,
        });
      }
    } catch (err) {
      results.push({
        sceneKey,
        ok: false,
        durationMs: Date.now() - startedAt,
        errorCode: "HANDLER_ERROR",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ ok: true, results });
}
