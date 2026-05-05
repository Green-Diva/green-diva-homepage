import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

// Stub deploy: marks the agent as deployed by stamping `deployedAt`.
// The actual runtime invocation layer (lib/agents/invoke.ts) is not yet
// implemented — this just records the user's intent so the UI can show
// "deployed" state and future invokers can skip drafts.
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;
  try {
    const updated = await prisma.agent.update({
      where: { id },
      data: { deployedAt: new Date() },
      select: { id: true, deployedAt: true },
    });
    return NextResponse.json(updated);
  } catch (e) {
    console.error("[api/agents/deploy POST] failed", e);
    return NextResponse.json({ error: "deploy failed" }, { status: 500 });
  }
}
