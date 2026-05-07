import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { skillCreateSchema } from "@/lib/validators";
import { AuthError, requireAdmin, requireUser } from "@/lib/auth";

// Convert validator output to Prisma write shape. Json fields need
// Prisma.JsonNull when caller explicitly sets null (Prisma rejects raw null
// for non-nullable Json columns; for nullable ones it would be misinterpreted
// as JsonNullValueInput.JsonNull anyway — see CLAUDE.md "Prisma 写入陷阱").
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

export async function GET() {
  try {
    await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const skills = await prisma.skill.findMany({
    orderBy: [{ level: "asc" }, { kind: "asc" }],
    include: { createdBy: { select: { id: true, name: true } } },
  });
  return NextResponse.json(skills);
}

export async function POST(req: NextRequest) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const json = await req.json().catch(() => null);
  const parsed = skillCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { handlerConfig, inputSchema, outputSchema, ...rest } = parsed.data;
  const jsonWrites = buildJsonWrites({ handlerConfig, inputSchema, outputSchema });

  try {
    const skill = await prisma.skill.create({
      data: { ...rest, ...jsonWrites, createdById: me.id },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    return NextResponse.json(skill, { status: 201 });
  } catch (e) {
    console.error("[skills] create failed", e);
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }
}
