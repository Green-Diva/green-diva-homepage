import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { relicCreateSchema } from "@/lib/relicValidators";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { getCurrentUser } from "@/lib/auth";
import { recordRelicLog } from "@/lib/relicLog";

export async function GET() {
  const [relics, user, unlockedIds] = await Promise.all([
    prisma.relic.findMany({
      orderBy: { slot: "asc" },
      select: {
        id: true,
        slot: true,
        slug: true,
        nameEn: true,
        nameZh: true,
        classifEn: true,
        classifZh: true,
        rarity: true,
        iconKey: true,
      },
    }),
    getCurrentUser(),
    getUnlockedRelicIds(),
  ]);
  const accessibleIds = relics
    .filter((r) => canAccessRelic(r, user, unlockedIds).ok)
    .map((r) => r.id);
  return NextResponse.json({ relics, accessibleIds });
}

export async function POST(req: NextRequest) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const json = await req.json().catch(() => null);
  const parsed = relicCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  if (data.rarity === "SPECIAL" && !data.password) {
    return NextResponse.json(
      { error: "SPECIAL relics require a password" },
      { status: 400 },
    );
  }
  const passwordHash = data.password ? await bcrypt.hash(data.password, 12) : null;

  try {
    const created = await prisma.relic.create({
      data: {
        slot: data.slot,
        slug: data.slug,
        nameEn: data.nameEn,
        nameZh: data.nameZh,
        classifEn: data.classifEn,
        classifZh: data.classifZh,
        rarity: data.rarity,
        iconKey: data.iconKey ?? null,
        modelPath: data.modelPath ?? null,
        photoPaths: data.photoPaths ?? [],
        loreEn: data.loreEn ?? null,
        loreZh: data.loreZh ?? null,
        acquiredAt: data.acquiredAt ? new Date(data.acquiredAt) : null,
        origin: data.origin ?? null,
        passwordHash,
      },
      select: { id: true, slug: true, nameEn: true },
    });
    await recordRelicLog({
      action: "CREATED",
      relic: { id: created.id, slug: created.slug, name: created.nameEn },
      actor: { id: me.id, name: me.name },
      details: { slot: data.slot, rarity: data.rarity },
    });
    return NextResponse.json({ id: created.id, slug: created.slug }, { status: 201 });
  } catch (e) {
    console.error("[api/relics POST] create failed", e);
    return NextResponse.json({ error: "create failed" }, { status: 400 });
  }
}
