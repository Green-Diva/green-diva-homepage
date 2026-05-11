import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { agentUpdateSchema } from "@/lib/validators";
import { AuthError, requireAdmin, requireUser } from "@/lib/auth";
import { respondError, respondAuthError, respondValidationError } from "@/lib/api-error";
import type { Prisma } from "@prisma/client";

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

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }
  const { id } = await params;
  try {
    await prisma.agent.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/agents DELETE] delete failed", e);
    return respondError("DELETE_FAILED", "delete failed", 400);
  }
}
