import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { agentUpdateSchema } from "@/lib/validators";
import { AuthError, requireAdmin, requireUser } from "@/lib/auth";
import type { Prisma } from "@prisma/client";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(agent);
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { id } = await params;
  const json = await req.json().catch(() => ({}));
  const parsed = agentUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data: Prisma.AgentUpdateInput = { ...(parsed.data as Prisma.AgentUpdateInput) };
  if ("skills" in data && data.skills === null) {
    delete data.skills;
  }

  try {
    const updated = await prisma.agent.update({
      where: { id },
      data,
    });
    return NextResponse.json(updated);
  } catch (e) {
    console.error("[api/agents PATCH] update failed", e);
    return NextResponse.json({ error: "update failed" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;
  try {
    await prisma.agent.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/agents DELETE] delete failed", e);
    return NextResponse.json({ error: "delete failed" }, { status: 400 });
  }
}
