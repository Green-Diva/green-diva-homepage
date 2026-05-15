import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { respondError, respondAuthError } from "@/lib/api-error";

type Ctx = { params: Promise<{ id: string }> };

// Deploy: stamps `deployedAt` + flips status=DEPLOYED AND converts the
// agent's draft-phase `intentSceneKeys` into real SceneBinding rows.
// Multiple agents may claim the same scene during drafting; deploy is
// the moment exclusivity is enforced — production routing for each
// claimed scene now points at THIS agent, overwriting any previous
// binding owner.
//
// Takeover semantics:
//   - existing SceneBinding for `sceneKey` → set agentId = this.id,
//     preserve enabled (so live traffic doesn't drop).
//   - no existing SceneBinding → create with agentId = this.id,
//     enabled = false (admin must flip enabled via
//     /agent-control?tab=scenes before traffic flows).
//
// Conflict semantics:
//   - "conflict" = sceneKey currently bound to a DIFFERENT agent. Deploy
//     stomps the previous owner's binding (the new agent takes over
//     production routing). UI must confirm before this happens.
//   - "fresh" = no binding exists yet for the sceneKey, OR binding already
//     points to this agent (idempotent re-deploy). No confirmation needed.
//
// Smoke testing (2026-05-15): the deploy gate that ran agent scene tests
// inline was removed. Tests now live behind the explicit "Test Run"
// button on the agent detail header (POST /api/agents/[id]/test-run) so
// admin chooses when to burn LLM / external-API budget. Deploy is back
// to a fast bindings-only commit.
//
// Two-phase protocol:
//   1. POST with no body → server returns 409 + { takeovers: [...] } if
//      conflicts exist; UI shows confirm modal listing them.
//   2. POST with { confirmTakeovers: true } → server commits the
//      bindings txn + stamps deployedAt + flips status=DEPLOYED.
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { confirmTakeovers?: boolean } | null;
  const confirmTakeovers = body?.confirmTakeovers === true;

  try {
    const agent = await prisma.agent.findUnique({
      where: { id },
      select: { id: true, intentSceneKeys: true },
    });
    if (!agent) return respondError("NOT_FOUND", "agent not found", 404);

    const existingBindings =
      agent.intentSceneKeys.length === 0
        ? []
        : await prisma.sceneBinding.findMany({
            where: { sceneKey: { in: agent.intentSceneKeys } },
            select: {
              sceneKey: true,
              agentId: true,
              enabled: true,
              agent: { select: { codename: true } },
            },
          });

    // Scenes this agent USED to own (live SceneBinding rows) but admin
    // unchecked in the Tune Agent modal. Re-deploy reconciles intent →
    // bindings, so these get dropped. Without this prune, unticking a
    // scene + Re-Deploy silently leaves the old binding pointing here.
    const orphanedBindings = await prisma.sceneBinding.findMany({
      where: {
        agentId: id,
        sceneKey: { notIn: agent.intentSceneKeys },
      },
      select: { sceneKey: true },
    });
    const orphanedSceneKeys = orphanedBindings.map((b) => b.sceneKey);

    const conflicts = existingBindings
      .filter((b) => b.agentId !== id)
      .map((b) => ({
        sceneKey: b.sceneKey,
        previousAgentId: b.agentId,
        previousAgentCodename: b.agent.codename,
        previouslyEnabled: b.enabled,
      }));

    if (conflicts.length > 0 && !confirmTakeovers) {
      return NextResponse.json(
        { errorCode: "TAKEOVER_CONFIRM_REQUIRED", takeovers: conflicts },
        { status: 409 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      if (orphanedSceneKeys.length > 0) {
        await tx.sceneBinding.deleteMany({
          where: { agentId: id, sceneKey: { in: orphanedSceneKeys } },
        });
      }
      for (const sceneKey of agent.intentSceneKeys) {
        const existing = await tx.sceneBinding.findUnique({ where: { sceneKey } });
        if (existing) {
          // Takeover OR idempotent re-deploy. Force enabled=true so admin's
          // explicit "Deploy" click is enough to flip the scene live — no
          // manual second step in /agent-control?tab=scenes (prepareAgentInput
          // shaping is owned by code since 2026-05-12, so no admin wiring is
          // missing).
          if (existing.agentId !== id || !existing.enabled) {
            await tx.sceneBinding.update({
              where: { sceneKey },
              data: { agentId: id, enabled: true },
            });
          }
        } else {
          await tx.sceneBinding.create({
            data: { sceneKey, agentId: id, enabled: true },
          });
        }
      }

      // Pin updatedAt to the same instant as deployedAt so the client's
      // "dirty = updatedAt > deployedAt" check doesn't trip on the few-ms
      // gap Prisma's `@updatedAt` would otherwise introduce (it generates
      // its own `new Date()` after ours). Without this override, every
      // fresh deploy immediately reads as "RE-DEPLOY" instead of "DEPLOYED".
      const now = new Date();
      return tx.agent.update({
        where: { id },
        data: { deployedAt: now, updatedAt: now, status: "DEPLOYED" },
        select: { id: true, deployedAt: true, status: true },
      });
    });

    return NextResponse.json({
      ...result,
      takeovers: conflicts,
      unboundSceneKeys: orphanedSceneKeys,
    });
  } catch (e) {
    console.error("[api/agents/deploy POST] failed", e);
    return respondError("DEPLOY_FAILED", "deploy failed", 500);
  }
}
