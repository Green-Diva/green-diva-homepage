// PATCH /api/scene-bindings/[sceneKey] — admin-only.
//
// Upsert the SceneBinding row for a registered scene. "Upsert" because the
// row may not yet exist (a newly-added scene whose seed migrate hasn't
// run, or a scene admin is binding for the first time via UI). The scene
// itself MUST be registered in code — we refuse to write a binding for
// an unknown sceneKey to avoid ghost rows that no dispatcher can find.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { respondError, respondAuthError, respondValidationError } from "@/lib/api-error";
import { getScene, SceneError } from "@/lib/agent-service";
import { sceneBindingUpdateSchema } from "@/lib/validators";
import "@/lib/scenes-init";

type Ctx = { params: Promise<{ sceneKey: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
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
    return respondError("INVALID_JSON", "invalid JSON body", 400);
  }

  const parsed = sceneBindingUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return respondValidationError(
      parsed.error.flatten(),
      "invalid binding: " +
        parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; "),
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
    // Intent sync (2026-05-15): when admin re-routes a scene from agent1
    // to agent2 via this editor, also reconcile both agents' intent
    // claims so the Tune Agent checkbox state matches the live binding.
    // Without this, agent1 keeps a dangling intent (re-deploys re-take)
    // and agent2 owns a binding it doesn't claim (re-deploy orphan-deletes
    // it). All three writes happen in one txn so production never sees
    // a half-synced state.
    const existing = await prisma.sceneBinding.findUnique({
      where: { sceneKey },
      select: { agentId: true },
    });
    const oldAgentId = existing?.agentId ?? null;
    const newAgentId = parsed.data.agentId;
    const agentChanged = oldAgentId !== null && oldAgentId !== newAgentId;

    const row = await prisma.$transaction(async (tx) => {
      const upserted = await tx.sceneBinding.upsert({
        where: { sceneKey },
        create: {
          sceneKey,
          agentId: newAgentId,
          enabled: parsed.data.enabled,
          notes: parsed.data.notes ?? null,
          customLabel: parsed.data.customLabel ?? null,
        },
        update: {
          agentId: newAgentId,
          enabled: parsed.data.enabled,
          notes: parsed.data.notes ?? null,
          customLabel: parsed.data.customLabel ?? null,
        },
        select: {
          sceneKey: true,
          agentId: true,
          enabled: true,
          updatedAt: true,
        },
      });

      // Remove sceneKey from the prior owner's intent (Postgres scalar-list
      // edits require a read-modify-write since Prisma has no "filter from
      // array" op).
      if (agentChanged) {
        const old = await tx.agent.findUnique({
          where: { id: oldAgentId! },
          select: { intentSceneKeys: true },
        });
        if (old && old.intentSceneKeys.includes(sceneKey)) {
          await tx.agent.update({
            where: { id: oldAgentId! },
            data: {
              intentSceneKeys: {
                set: old.intentSceneKeys.filter((k) => k !== sceneKey),
              },
            },
          });
        }
      }

      // Make sure the new owner claims it. Idempotent — only writes if
      // the key isn't already there.
      const next = await tx.agent.findUnique({
        where: { id: newAgentId },
        select: { intentSceneKeys: true },
      });
      if (next && !next.intentSceneKeys.includes(sceneKey)) {
        await tx.agent.update({
          where: { id: newAgentId },
          data: {
            intentSceneKeys: { set: [...next.intentSceneKeys, sceneKey] },
          },
        });
      }

      return upserted;
    });
    return NextResponse.json(row);
  } catch (e) {
    if (e instanceof SceneError) {
      return respondError(e.errorCode, e.message, e.httpStatus);
    }
    console.error(`[api/scene-bindings] PATCH ${sceneKey} failed`, e);
    return respondError("SAVE_FAILED", "save failed", 500);
  }
}
