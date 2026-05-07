// Admin-only synchronous Test Invoke. Used by SkillEditor's "Test Invoke"
// button to validate a skill's handlerConfig + schemas with sample input
// before flipping its status to ONLINE.
//
// Synchronous on purpose — short feedback loop for editing. Production
// invocations from agents go through the async AgentJob path (Phase 2).
// Long handler calls may hit Next.js HTTP timeout (~30s on serverless);
// that's acceptable for editor-time testing.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { skillTestInvokeSchema } from "@/lib/validators";
import { AuthError, requireAdmin } from "@/lib/auth";
import { invokeSkill } from "@/lib/skills/invoke";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = skillTestInvokeSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const skill = await prisma.skill.findUnique({ where: { id } });
  if (!skill) return NextResponse.json({ error: "not found" }, { status: 404 });

  const startedAt = Date.now();
  const result = await invokeSkill(skill, parsed.data.input);
  const durationMs = Date.now() - startedAt;

  return NextResponse.json({ ...result, durationMs });
}
