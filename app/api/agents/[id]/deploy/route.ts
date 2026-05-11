import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { respondError, respondAuthError } from "@/lib/api-error";

type Ctx = { params: Promise<{ id: string }> };

// Deploy: stamps `deployedAt` AND converts the agent's draft-phase
// `intentSceneKeys` into real SceneBinding rows. Multiple agents may
// claim the same scene during drafting; deploy is the moment exclusivity
// is enforced — production routing for each claimed scene now points at
// THIS agent, overwriting any previous binding owner.
//
// Takeover semantics:
//   - existing SceneBinding for `sceneKey` → set agentId = this.id,
//     preserve inputMap + enabled (so live traffic doesn't drop and
//     admin-curated inputMap survives the switch).
//   - no existing SceneBinding → create with agentId = this.id,
//     inputMap = {}, enabled = false (admin must fill inputMap and flip
//     enabled via /agent-control?tab=scenes before traffic flows).
// Conflict semantics:
//   - "conflict" = sceneKey currently bound to a DIFFERENT agent. Deploy
//     stomps the previous owner's binding (the new agent takes over
//     production routing). UI must confirm before this happens.
//   - "fresh" = no binding exists yet for the sceneKey, OR binding already
//     points to this agent (idempotent re-deploy). No confirmation needed.
//
// Two-phase protocol:
//   1. POST with no body → server returns 409 + { takeovers: [...] } if
//      conflicts exist; UI shows confirm modal listing them.
//   2. POST with { confirmTakeovers: true } → server proceeds regardless,
//      stamps deployedAt, materializes/transfers SceneBinding rows.
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
    // Pre-flight: enumerate conflicts before the write txn so we can
    // surface them to the UI without partial side effects.
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
      for (const sceneKey of agent.intentSceneKeys) {
        const existing = await tx.sceneBinding.findUnique({ where: { sceneKey } });
        if (existing) {
          if (existing.agentId !== id) {
            await tx.sceneBinding.update({
              where: { sceneKey },
              data: { agentId: id },
            });
          }
        } else {
          await tx.sceneBinding.create({
            data: { sceneKey, agentId: id, inputMap: {}, enabled: false },
          });
        }
      }

      return tx.agent.update({
        where: { id },
        data: { deployedAt: new Date() },
        select: { id: true, deployedAt: true },
      });
    });

    return NextResponse.json({ ...result, takeovers: conflicts });
  } catch (e) {
    console.error("[api/agents/deploy POST] failed", e);
    return respondError("DEPLOY_FAILED", "deploy failed", 500);
  }
}
