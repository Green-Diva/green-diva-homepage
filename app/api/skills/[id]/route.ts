import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { skillUpdateSchema } from "@/lib/validators";
import { AuthError, requireAdmin, requireUser } from "@/lib/auth";

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
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;
  const skill = await prisma.skill.findUnique({
    where: { id },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  if (!skill) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(skill);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = skillUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
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
    console.error("[skills] update failed", e);
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;
  try {
    await prisma.skill.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[skills] delete failed", e);
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
