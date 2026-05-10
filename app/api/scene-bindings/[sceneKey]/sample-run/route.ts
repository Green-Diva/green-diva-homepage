// POST /api/scene-bindings/[sceneKey]/sample-run — admin-only.
//
// Dry-run a scene's saved binding with an admin-supplied ctx. Bypasses
// the runner (no AgentJob row, no maybeWriteRelicAsset writeback) so
// admin can poke around without mutating relic columns. Skill handlers
// that have side effects (fal.ai writes a cutout PNG, Meshy uploads,
// etc.) still execute their side effects — a true "no-touch" dry-run
// isn't possible without making every handler dry-run-aware. Admin is
// expected to know which scenes are safe to sample-run.
//
// "Sample Run" tests the SAVED binding, not the modal's in-progress
// edits — so admin sees the binding they're about to live-fire, not
// what's typed in the textarea.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { applyTemplate, getScene } from "@/lib/agent-service";
import { invokeAgent } from "@/lib/agents/invoke";
import { sceneSampleRunSchema } from "@/lib/validators";
import "@/lib/scenes-init";

const TIMEOUT_MS = 5 * 60_000;

type Ctx = { params: Promise<{ sceneKey: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { sceneKey } = await params;

  const scene = getScene(sceneKey);
  if (!scene) {
    return NextResponse.json({ error: `scene "${sceneKey}" is not registered` }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsedBody = sceneSampleRunSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error:
          "invalid body: " +
          parsedBody.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; "),
      },
      { status: 400 },
    );
  }

  const ctxResult = scene.contextSchema.safeParse(parsedBody.data.ctx);
  if (!ctxResult.success) {
    return NextResponse.json(
      {
        error:
          "ctx invalid: " +
          ctxResult.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; "),
      },
      { status: 400 },
    );
  }

  const binding = await prisma.sceneBinding.findUnique({ where: { sceneKey } });
  if (!binding) {
    return NextResponse.json(
      { error: `scene "${sceneKey}" has no binding to sample` },
      { status: 404 },
    );
  }

  const agent = await prisma.agent.findUnique({ where: { id: binding.agentId } });
  if (!agent) {
    return NextResponse.json({ error: "bound agent no longer exists" }, { status: 503 });
  }
  if (!agent.deployedAt) {
    return NextResponse.json({ error: "bound agent is not deployed" }, { status: 503 });
  }

  let agentInput: unknown;
  try {
    agentInput = applyTemplate(binding.inputMap, {
      ctx: ctxResult.data,
      actor: { userId: me.id, level: me.level, name: me.name },
    } as Record<string, unknown>);
  } catch (e) {
    return NextResponse.json(
      {
        error: `inputMap apply failed: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 500 },
    );
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<{ __timeout: true }>((resolve) => {
    timer = setTimeout(() => resolve({ __timeout: true }), TIMEOUT_MS);
  });

  let raced;
  try {
    raced = await Promise.race([
      invokeAgent({ agent, mode: agent.mode, input: agentInput }),
      timeoutPromise,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }

  if ("__timeout" in raced) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: "TIMEOUT",
        errorMessage: `sample run exceeded ${TIMEOUT_MS}ms`,
      },
      { status: 504 },
    );
  }

  if (!raced.ok) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: raced.errorCode,
        errorMessage: raced.errorMessage,
        runLog: raced.runLog,
        agentInput,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    output: raced.output,
    runLog: raced.runLog,
    agentInput,
  });
}
