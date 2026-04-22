import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { projectCreateSchema } from "@/lib/validators";
import { requireAdmin } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const includeUnpublished = url.searchParams.get("all") === "1";
  const auth = includeUnpublished ? requireAdmin(req) : { ok: true as const };
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const projects = await prisma.project.findMany({
    where: includeUnpublished ? {} : { published: true },
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(projects);
}

export async function POST(req: NextRequest) {
  const auth = requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const json = await req.json().catch(() => null);
  const parsed = projectCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const created = await prisma.project.create({ data: parsed.data });
    return NextResponse.json(created, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "create failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
