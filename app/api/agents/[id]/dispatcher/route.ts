import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { agentDispatcherSchema } from "@/lib/validators";
import { AuthError, requireAdmin } from "@/lib/auth";
import { respondError, respondAuthError, respondValidationError } from "@/lib/api-error";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }
  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = agentDispatcherSchema.safeParse(json);
  if (!parsed.success) {
    return respondValidationError(parsed.error.flatten());
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
    return respondError("SAVE_FAILED", "save failed", 500);
  }
}
