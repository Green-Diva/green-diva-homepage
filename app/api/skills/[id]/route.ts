import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { skillUpdateSchema } from "@/lib/validators";
import { AuthError, requireAdmin, requireUser } from "@/lib/auth";
import { respondError, respondAuthError, respondValidationError } from "@/lib/api-error";

type Params = { params: Promise<{ id: string }> };

// Same Prisma.JsonNull handling as POST /api/skills (see route.ts).
function buildJsonWrites(parsed: {
  handlerConfig?: Record<string, unknown>;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
}) {
  const writes: {
    handlerConfig?: Prisma.InputJsonValue;
    inputSchema?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    outputSchema?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  } = {};
  if (parsed.handlerConfig !== undefined) {
    writes.handlerConfig = parsed.handlerConfig as Prisma.InputJsonValue;
  }
  if (parsed.inputSchema !== undefined) {
    writes.inputSchema = parsed.inputSchema === null
      ? Prisma.JsonNull
      : (parsed.inputSchema as Prisma.InputJsonValue);
  }
  if (parsed.outputSchema !== undefined) {
    writes.outputSchema = parsed.outputSchema === null
      ? Prisma.JsonNull
      : (parsed.outputSchema as Prisma.InputJsonValue);
  }
  return writes;
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }
  const { id } = await params;
  const skill = await prisma.skill.findUnique({
    where: { id },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  if (!skill) return respondError("NOT_FOUND", "not found", 404);
  return NextResponse.json(skill);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }
  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = skillUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return respondValidationError(parsed.error.flatten());
  }
  const { handlerConfig, inputSchema, outputSchema, ...rest } = parsed.data;
  const jsonWrites = buildJsonWrites({ handlerConfig, inputSchema, outputSchema });
  try {
    const skill = await prisma.skill.update({
      where: { id },
      data: { ...rest, ...jsonWrites },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    return NextResponse.json(skill);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return respondError("SKILL_SLUG_CONFLICT", "slug already in use", 409);
    }
    console.error("[skills] update failed", e);
    return respondError("UPDATE_FAILED", "update failed", 500);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }
  const { id } = await params;

  // AgentSkillEquip.skill is `onDelete: Cascade` in the schema (legacy
  // wrong default — the cascade silently strips the skill from any
  // equipped agent's loadout, but the agent's pipelineConfig JSON still
  // references the slotIndex → next invocation fails mid-DAG with
  // SLOT_EMPTY). Pre-flight refusal mirrors the agent DELETE pattern:
  // force admin to unequip first via /agent-control's agent editor.
  const equips = await prisma.agentSkillEquip.findMany({
    where: { skillId: id },
    select: { agent: { select: { codename: true } } },
  });
  if (equips.length > 0) {
    const agents = equips.map((e) => e.agent.codename).join(", ");
    return respondError(
      "CONFLICT",
      `skill is equipped on ${equips.length} agent(s) — unequip first in /agent-control's agent editor: ${agents}`,
      409,
    );
  }

  try {
    await prisma.skill.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return respondError("NOT_FOUND", "skill not found", 404);
    }
    console.error("[skills] delete failed", e);
    return respondError("DELETE_FAILED", "delete failed", 500);
  }
}
