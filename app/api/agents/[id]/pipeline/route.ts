import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { agentPipelineSchema } from "@/lib/validators";
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
  const parsed = agentPipelineSchema.safeParse(json);
  if (!parsed.success) {
    return respondValidationError(parsed.error.flatten());
  }
  try {
    const updated = await prisma.agent.update({
      where: { id },
      data: {
        pipelineConfig:
          parsed.data.config === null
            ? Prisma.JsonNull
            : (parsed.data.config as Prisma.InputJsonValue),
      },
      select: { id: true, pipelineConfig: true },
    });
    return NextResponse.json(updated);
  } catch (e) {
    console.error("[api/agents/pipeline PUT] failed", e);
    return respondError("SAVE_FAILED", "save failed", 500);
  }
}
