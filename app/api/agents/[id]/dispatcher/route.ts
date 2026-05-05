import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { agentDispatcherSchema } from "@/lib/validators";
import { AuthError, requireAdmin } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = agentDispatcherSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const updated = await prisma.agent.update({
      where: { id },
      data: {
        dispatcherConfig:
          parsed.data.config === null
            ? Prisma.JsonNull
            : (parsed.data.config as Prisma.InputJsonValue),
      },
      select: { id: true, dispatcherConfig: true },
    });
    return NextResponse.json(updated);
  } catch (e) {
    console.error("[api/agents/dispatcher PUT] failed", e);
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }
}
