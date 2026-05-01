import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Admin-only for now — surfacing curatorial activity to non-admin viewers
  // is a separate product question.
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await ctx.params;
  const logs = await prisma.relicLog.findMany({
    where: { relicId: id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      action: true,
      actorNameSnapshot: true,
      targetNameSnapshot: true,
      notes: true,
      details: true,
      createdAt: true,
    },
  });
  return NextResponse.json(logs);
}
