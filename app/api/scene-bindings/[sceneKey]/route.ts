// PATCH /api/scene-bindings/[sceneKey] — admin-only.
//
// Upsert the SceneBinding row for a registered scene. "Upsert" because the
// row may not yet exist (a newly-added scene whose seed migrate hasn't
// run, or a scene admin is binding for the first time via UI). The scene
// itself MUST be registered in code — we refuse to write a binding for
// an unknown sceneKey to avoid ghost rows that no dispatcher can find.

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { getScene, SceneError } from "@/lib/agent-service";
import { sceneBindingUpdateSchema } from "@/lib/validators";
import "@/lib/scenes-init";

type Ctx = { params: Promise<{ sceneKey: string }> };

function jsonOrNull(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return v === undefined || v === null ? Prisma.JsonNull : (v as Prisma.InputJsonValue);
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { sceneKey } = await params;

  // Refuse unknown scenes — admin would create a row no dispatcher can find.
  const scene = getScene(sceneKey);
  if (!scene) {
    return NextResponse.json(
      {
        error: `scene "${sceneKey}" is not registered in code; bindings can only target scenes declared via registerScene()`,
      },
      { status: 404 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = sceneBindingUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "invalid binding: " +
          parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; "),
      },
      { status: 400 },
    );
  }

  // Reject agent that no longer exists OR doesn't carry every required
  // capability. Soft-warning would be nicer (let admin save then surface
  // mismatch), but a 400 keeps the data clean and matches the SceneBinding
  // FK semantics (agent rows are RESTRICT, so we shouldn't create a row
  // pointing at one that's about to be invalid).
  const agent = await prisma.agent.findUnique({
    where: { id: parsed.data.agentId },
    select: { id: true, capabilities: true, deployedAt: true },
  });
  if (!agent) {
    return NextResponse.json(
      { error: `agent ${parsed.data.agentId} not found` },
      { status: 400 },
    );
  }
  const have = new Set(agent.capabilities);
  const missing = scene.requiredCapabilities.filter((c) => !have.has(c));
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `agent missing required capabilities: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const row = await prisma.sceneBinding.upsert({
      where: { sceneKey },
      create: {
        sceneKey,
        agentId: parsed.data.agentId,
        inputMap: jsonOrNull(parsed.data.inputMap),
        outputMap: jsonOrNull(parsed.data.outputMap ?? null),
        enabled: parsed.data.enabled,
        notes: parsed.data.notes ?? null,
        rolloutPct: parsed.data.rolloutPct ?? 100,
        fallbackAgentId: parsed.data.fallbackAgentId ?? null,
      },
      update: {
        agentId: parsed.data.agentId,
        inputMap: jsonOrNull(parsed.data.inputMap),
        outputMap: jsonOrNull(parsed.data.outputMap ?? null),
        enabled: parsed.data.enabled,
        notes: parsed.data.notes ?? null,
        ...(parsed.data.rolloutPct !== undefined ? { rolloutPct: parsed.data.rolloutPct } : {}),
        ...(parsed.data.fallbackAgentId !== undefined
          ? { fallbackAgentId: parsed.data.fallbackAgentId }
          : {}),
      },
      select: {
        sceneKey: true,
        agentId: true,
        enabled: true,
        rolloutPct: true,
        updatedAt: true,
      },
    });
    return NextResponse.json(row);
  } catch (e) {
    if (e instanceof SceneError) {
      return NextResponse.json({ error: e.message }, { status: e.httpStatus });
    }
    console.error(`[api/scene-bindings] PATCH ${sceneKey} failed`, e);
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }
}
