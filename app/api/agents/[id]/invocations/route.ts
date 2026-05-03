import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ADMIN_LEVEL, AuthError, requireUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

const MAX_LIMIT = 50;

export async function GET(req: NextRequest, { params }: Ctx) {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  if (me.level < ADMIN_LEVEL) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), MAX_LIMIT) : 10;

  const rows = await prisma.agentInvocation.findMany({
    where: { agentId: id },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      ok: true,
      source: true,
      latencyMs: true,
      errorMessage: true,
      createdAt: true,
    },
  });
  return NextResponse.json(rows);
}
