import { NextRequest, NextResponse } from "next/server";
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
  // capture before-state for diff log + cascade prune base
  const before = await prisma.relic.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      nameEn: true,
      slot: true,
      rarity: true,
      passwordHash: true,
      enhancedImages: true,
    },
  });
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Cascade prune: when the candidate list has soft-deletes (deleted=true),
  // drop the matching enhancedImages entries (keyed on sourceCandidatePath).
  // Server-side bottleneck — even if a client forgets to prune its own copy
  // of enhancedImages, the DB stays consistent.
  if (Array.isArray(data.candidateImages)) {
    const deletedPaths = new Set(
      data.candidateImages
        .filter((c) => c.deleted === true && typeof c.path === "string")
        .map((c) => c.path as string),
    );
    if (deletedPaths.size > 0) {
      const base = Array.isArray(update.enhancedImages)
        ? (update.enhancedImages as Array<{ sourceCandidatePath?: string }>)
        : Array.isArray(before.enhancedImages)
          ? (before.enhancedImages as Array<{ sourceCandidatePath?: string }>)
          : [];
      const pruned = base.filter(
        (e) =>
          typeof e?.sourceCandidatePath !== "string" ||
          !deletedPaths.has(e.sourceCandidatePath),
      );
      update.enhancedImages = pruned;
    }
  }
  // Rarity transition: SPECIAL → non-SPECIAL clears any retained passwordHash;
  // non-SPECIAL → SPECIAL without a fresh password is rejected (admin must
  // supply a passphrase to lock the relic).
  if ("rarity" in data && data.rarity && data.rarity !== before.rarity) {
    if (data.rarity !== "SPECIAL" && before.rarity === "SPECIAL") {
      update.passwordHash = null;
    }
    if (data.rarity === "SPECIAL" && before.rarity !== "SPECIAL" && !before.passwordHash && !("password" in data && data.password)) {
      return NextResponse.json(
        { error: "transitioning to SPECIAL requires a passphrase" },
        { status: 400 },
      );
    }
  }
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

