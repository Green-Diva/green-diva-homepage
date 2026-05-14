import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { agentUpdateSchema } from "@/lib/validators";
import { AuthError, requireAdmin, requireUser } from "@/lib/auth";
import { respondError, respondAuthError, respondValidationError } from "@/lib/api-error";
import { Prisma } from "@prisma/client";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }
  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  if (!agent) return respondError("NOT_FOUND", "not found", 404);
  return NextResponse.json(agent);
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }

  const { id } = await params;
  const json = await req.json().catch(() => ({}));
  const parsed = agentUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return respondValidationError(parsed.error.flatten());
  }

  const data: Prisma.AgentUpdateInput = { ...(parsed.data as Prisma.AgentUpdateInput) };
  if ("skills" in data && data.skills === null) {
    delete data.skills;
  }
  // Prisma scalar-list update requires `{ set: [...] }` shape.
  if (Array.isArray(parsed.data.intentSceneKeys)) {
    data.intentSceneKeys = { set: parsed.data.intentSceneKeys };
  }

  try {
    const updated = await prisma.agent.update({
      where: { id },
      data,
    });
    return NextResponse.json(updated);
  } catch (e) {
    console.error("[api/agents PATCH] update failed", e);
    return respondError("UPDATE_FAILED", "update failed", 400);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }
  const { id } = await params;
  // ?cascade=1 → atomically drop SceneBinding rows pointing at this agent
  // and then delete the agent. Without it, the safe pre-flight refuses
  // and tells admin which scenes block the delete (so the UI can render
  // a confirm modal listing them, then re-call with cascade=1).
  const cascade = new URL(req.url).searchParams.get("cascade") === "1";

  // SceneBinding.agentId is `onDelete: Restrict` in the schema (intentional —
  // we don't want a vanished agent to silently break N scenes). Read first
  // to surface an actionable error OR enumerate which scenes will be
  // unbound by a cascade delete; the response body returns this list either
  // way so the UI can show "you're about to unbind X, Y, Z" in its confirm.
  const liveBindings = await prisma.sceneBinding.findMany({
    where: { agentId: id },
    select: { sceneKey: true },
  });
  const sceneKeys = liveBindings.map((b) => b.sceneKey);

  if (liveBindings.length > 0 && !cascade) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: "CONFLICT",
        errorMessage: `agent is bound to ${liveBindings.length} scene(s) — unbind in /agent-control?tab=scenes first, or retry with ?cascade=1: ${sceneKeys.join(", ")}`,
        error: `agent is bound to ${liveBindings.length} scene(s) — unbind in /agent-control?tab=scenes first, or retry with ?cascade=1: ${sceneKeys.join(", ")}`,
        sceneKeys,
      },
      { status: 409 },
    );
  }

  try {
    if (cascade && liveBindings.length > 0) {
      // Single transaction: drop bindings then delete the agent. If the
      // agent delete fails (P2003 from a binding race, P2025 from concurrent
      // delete) the binding deletes also roll back, leaving scenes pointed
      // at the agent rather than half-orphaned.
      await prisma.$transaction(async (tx) => {
        await tx.sceneBinding.deleteMany({ where: { agentId: id } });
        await tx.agent.delete({ where: { id } });
      });
    } else {
      await prisma.agent.delete({ where: { id } });
    }
    return NextResponse.json({
      ok: true,
      cascadedSceneKeys: cascade ? sceneKeys : [],
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      // P2003 = FK constraint (typically a SceneBinding raced into
      // existence after our pre-flight). P2025 = record not found.
      if (e.code === "P2003") {
        return respondError(
          "CONFLICT",
          "agent has dependent rows blocking delete (race condition). Refresh and retry.",
          409,
        );
      }
      if (e.code === "P2025") {
        return respondError("NOT_FOUND", "agent not found", 404);
      }
    }
    console.error("[api/agents DELETE] delete failed", e);
    return respondError("DELETE_FAILED", "delete failed", 500);
  }
}
