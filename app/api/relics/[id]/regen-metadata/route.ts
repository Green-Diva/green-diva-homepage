// POST /api/relics/[id]/regen-metadata — admin-only, **synchronous**.
//
// Routes through the agent-service's "relic.regen-metadata" scene with
// the relic's current loreZh/loreEn (and optional admin feedback) and
// returns the new metadata fields for the RelicForm to preview. Does
// NOT persist — admin clicks "应用" in the UI to PATCH the relic with
// the chosen values.
//
// Body: `{ feedback?: string }`
// Returns: `{ titleZh, titleEn, subtitleZh, subtitleEn, icon, rarity, formKind }`

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { callScene, SceneError } from "@/lib/agent-service";

type Ctx = { params: Promise<{ id: string }> };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function POST(req: NextRequest, { params }: Ctx) {
  let me;
  try {
    me = await requireAdmin();
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

  let result;
  try {
    result = await callScene(
      "relic.regen-metadata",
      {
        relicSlug: relic.slug,
        existingLore: { zh: relic.loreZh, en: relic.loreEn },
        ...(feedback ? { feedback } : {}),
      },
      {
        actor: { userId: me.id, level: me.level, name: me.name },
        // Regen reuses lore (no grounded research) so it's quick — but
        // metadata derivation still hits Gemini. Bump above the default
        // to absorb cold-start latency without timing out.
        timeoutMs: 60_000,
      },
    );
  } catch (e) {
    if (e instanceof SceneError) {
      return NextResponse.json({ error: e.message }, { status: e.httpStatus });
    }
    console.error("[api/relics/regen-metadata] callScene threw", e);
    return NextResponse.json({ error: "regen failed" }, { status: 500 });
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: `agent failed (${result.errorCode}): ${result.errorMessage}` },
      { status: 502 },
    );
  }

  // Scene contract (lib/relics/scenes.ts → relicRegenMetadataScene)
  // guarantees flat result.output shape. The bound agent's leaf
  // (currently LORE-FORGE-001's metadata-regen node) produces that
  // shape directly; admin can swap to a different agent as long as its
  // tail node satisfies the same outputSchema.
  const out = isObject(result.output) ? result.output : {};

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
