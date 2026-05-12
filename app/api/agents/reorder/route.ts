import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { respondError, respondAuthError, respondValidationError } from "@/lib/api-error";

const reorderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }

  const json = await req.json().catch(() => null);
  const parsed = reorderSchema.safeParse(json);
  if (!parsed.success) return respondValidationError(parsed.error.flatten());

  const { ids } = parsed.data;
  const allAgents = await prisma.agent.findMany({ select: { id: true } });
  const dbIds = new Set(allAgents.map((a) => a.id));
  const inputIds = new Set(ids);
  if (
    ids.length !== dbIds.size ||
    inputIds.size !== ids.length ||
    [...inputIds].some((id) => !dbIds.has(id))
  ) {
    return respondError("VALIDATION_FAILED", "ids must be a permutation of all Agent rows", 400);
  }

  try {
    await prisma.$transaction(
      ids.map((id, i) =>
        prisma.agent.update({ where: { id }, data: { displayOrder: i } }),
      ),
    );
  } catch {
    return respondError("UPDATE_FAILED", "reorder failed", 500);
  }

  return NextResponse.json({ ok: true });
}
