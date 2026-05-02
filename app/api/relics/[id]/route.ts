import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { AuthError, getCurrentUser, requireAdmin } from "@/lib/auth";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { relicUpdateSchema } from "@/lib/relicValidators";
import { recordRelicLog } from "@/lib/relicLog";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const relic = await prisma.relic.findUnique({ where: { id } });
  if (!relic) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [user, unlockedIds] = await Promise.all([getCurrentUser(), getUnlockedRelicIds()]);
  const access = canAccessRelic(relic, user, unlockedIds);
  if (access.level === "RED") {
    return NextResponse.json(
      {
        error: "locked",
        reason: access.reason,
        ...(access.reason === "locked-level" ? { required: access.required } : {}),
        rarity: relic.rarity,
      },
      { status: 403 },
    );
  }
  // strip passwordHash
  const { passwordHash: _ph, ...safe } = relic;
  void _ph;
  return NextResponse.json(safe);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = relicUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const update: Record<string, unknown> = { ...data };
  if ("password" in data) {
    update.passwordHash = data.password ? await bcrypt.hash(data.password, 12) : null;
    delete update.password;
  }
  if ("acquiredAt" in data) {
    update.acquiredAt = data.acquiredAt ? new Date(data.acquiredAt) : null;
  }
  // capture before-state for diff log
  const before = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, slug: true, nameEn: true, slot: true, rarity: true },
  });
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    await prisma.relic.update({ where: { id }, data: update });
    // Determine which kind of edit this was for the audit log
    const slotChanged = "slot" in data && data.slot != null && data.slot !== before.slot;
    const rarityChanged = "rarity" in data && data.rarity && data.rarity !== before.rarity;
    const passwordChanged = "password" in data;
    const otherFields = Object.keys(data).filter(
      (k) => !["slot", "rarity", "password"].includes(k),
    );

    const logs: Promise<void>[] = [];
    const relicSnap = { id: before.id, slug: before.slug, name: before.nameEn };
    if (slotChanged) {
      logs.push(
        recordRelicLog({
          action: "MOVED",
          relic: relicSnap,
          actor: { id: me.id, name: me.name },
          details: { from: before.slot, to: data.slot },
        }),
      );
    }
    if (rarityChanged) {
      logs.push(
        recordRelicLog({
          action: "RARITY_CHANGED",
          relic: relicSnap,
          actor: { id: me.id, name: me.name },
          details: { from: before.rarity, to: data.rarity },
        }),
      );
    }
    if (otherFields.length > 0 || passwordChanged) {
      logs.push(
        recordRelicLog({
          action: "EDITED",
          relic: relicSnap,
          actor: { id: me.id, name: me.name },
          details: {
            fields: otherFields,
            ...(passwordChanged ? { passwordReset: true } : {}),
          },
        }),
      );
    }
    await Promise.all(logs);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/relics PATCH] update failed", e);
    return NextResponse.json({ error: "update failed" }, { status: 400 });
  }
}

const deleteBody = z.object({
  targetUserId: z.string().min(1).max(64).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await ctx.params;
  // Accept optional body { targetUserId?, notes? } describing who the
  // extracted item was given to (may be sent as JSON or absent).
  let body: { targetUserId?: string | null; notes?: string | null } = {};
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const json = await req.json();
      const parsed = deleteBody.safeParse(json);
      if (parsed.success) body = parsed.data;
    }
  } catch {
    // ignore — empty body is fine
  }

  const before = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, slug: true, nameEn: true, slot: true, rarity: true },
  });
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });

  let target: { id: string; name: string } | null = null;
  if (body.targetUserId) {
    const u = await prisma.user.findUnique({
      where: { id: body.targetUserId },
      select: { id: true, name: true },
    });
    if (u) target = u;
  }

  try {
    await prisma.relic.delete({ where: { id } });
    await recordRelicLog({
      action: "EXTRACTED",
      relic: { id: before.id, slug: before.slug, name: before.nameEn },
      actor: { id: me.id, name: me.name },
      target,
      notes: body.notes ?? null,
      details: { slot: before.slot, rarity: before.rarity },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/relics DELETE] delete failed", e);
    return NextResponse.json({ error: "delete failed" }, { status: 400 });
  }
}
