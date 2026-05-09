// POST /api/relics/[id]/confirm — flips AWAITING_REVIEW → READY.
//
// Admin-only. Idempotent: if the relic is already READY (or in any other
// non-AWAITING_REVIEW status), return 200 with status unchanged. Other
// transitions (DRAFT/PROCESSING/PARTIAL/FAILED) are left to PATCH +
// pipeline retry — confirm is exclusively the "first-time review passed"
// signal, not a generic status setter.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { recordRelicLog } from "@/lib/relicLog";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await ctx.params;

  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, slug: true, nameEn: true, status: true },
  });
  if (!relic) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (relic.status === "READY") {
    return NextResponse.json({ ok: true, status: "READY", changed: false });
  }
  if (relic.status !== "AWAITING_REVIEW") {
    // Don't silently force a transition out of DRAFT/PROCESSING/etc.
    return NextResponse.json(
      { error: `cannot confirm relic in status ${relic.status}` },
      { status: 409 },
    );
  }

  const updated = await prisma.relic.update({
    where: { id },
    data: { status: "READY" },
    select: { id: true, slug: true, nameEn: true, status: true },
  });

  await recordRelicLog({
    action: "EDITED",
    relic: { id: updated.id, slug: updated.slug, name: updated.nameEn },
    actor: { id: me.id, name: me.name },
    notes: "First-review confirmed; AWAITING_REVIEW → READY",
  });

  return NextResponse.json({ ok: true, status: updated.status, changed: true });
}
