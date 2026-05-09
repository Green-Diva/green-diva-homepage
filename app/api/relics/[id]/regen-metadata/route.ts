// POST /api/relics/[id]/regen-metadata — admin-only, **synchronous**.
//
// Calls the relic scribe agent in `mode: "regenMetadata"` with the relic's
// current loreZh/loreEn (and optional admin feedback) and returns the new
// metadata fields for the RelicForm to preview. Does NOT persist — admin
// clicks "应用" in the UI to PATCH the relic with the chosen values.
//
// Body: `{ feedback?: string }`
// Returns: `{ titleZh, titleEn, subtitleZh, subtitleEn, icon, rarity, formKind }`

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { invokeAgent, type AgentRunLogEntry } from "@/lib/agents/invoke";

const SCRIBE_CODENAME = "RELIC-SCRIBE-001";

type Ctx = { params: Promise<{ id: string }> };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function findNodeOutput(runLog: AgentRunLogEntry[], stepId: string): unknown | undefined {
  for (let i = runLog.length - 1; i >= 0; i -= 1) {
    const e = runLog[i];
    if (e.stepId === stepId && e.ok && !e.skipped) return e.output;
  }
  return undefined;
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { feedback?: unknown };
  const feedback =
    typeof body?.feedback === "string" ? body.feedback.trim().slice(0, 500) : undefined;

  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, slug: true, loreZh: true, loreEn: true },
  });
  if (!relic) return NextResponse.json({ error: "relic not found" }, { status: 404 });
  if (!relic.loreZh || !relic.loreEn) {
    return NextResponse.json(
      { error: "relic has no lore — finish initial review first" },
      { status: 409 },
    );
  }

  const agent = await prisma.agent.findUnique({
    where: { codename: SCRIBE_CODENAME },
  });
  if (!agent) return NextResponse.json({ error: "scribe agent missing" }, { status: 503 });
  if (!agent.deployedAt) {
    return NextResponse.json({ error: "scribe agent not deployed" }, { status: 503 });
  }

  let result;
  try {
    result = await invokeAgent({
      agent,
      mode: agent.mode,
      input: {
        mode: "regenMetadata",
        relicSlug: relic.slug,
        existingLore: { zh: relic.loreZh, en: relic.loreEn },
        ...(feedback ? { feedback } : {}),
      },
    });
  } catch (e) {
    console.error("[api/relics/regen-metadata] invokeAgent threw", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "regen failed" },
      { status: 500 },
    );
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: `agent failed (${result.errorCode}): ${result.errorMessage}` },
      { status: 502 },
    );
  }

  // Pull from research-regen node specifically (or fall back to leaf output).
  const fromNode = findNodeOutput(result.runLog, "research-regen");
  const out = isObject(fromNode) ? fromNode : isObject(result.output) ? result.output : {};

  return NextResponse.json({
    titleZh: typeof out.titleZh === "string" ? out.titleZh : "",
    titleEn: typeof out.titleEn === "string" ? out.titleEn : "",
    subtitleZh: typeof out.subtitleZh === "string" ? out.subtitleZh : "",
    subtitleEn: typeof out.subtitleEn === "string" ? out.subtitleEn : "",
    icon: typeof out.icon === "string" ? out.icon : "",
    rarity: typeof out.rarity === "string" ? out.rarity : "COMMON",
    formKind: typeof out.formKind === "string" ? out.formKind : null,
  });
}
