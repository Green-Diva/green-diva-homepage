import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ADMIN_LEVEL, AuthError, requireAdmin } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 64);
  const where = q
    ? { name: { contains: q, mode: "insensitive" as const } }
    : {};
  const users = await prisma.user.findMany({
    where: { ...where, level: { lt: ADMIN_LEVEL } },
    select: { id: true, name: true, level: true, serial: true },
    orderBy: { serial: "asc" },
    take: 20,
  });
  return NextResponse.json(users);
}
