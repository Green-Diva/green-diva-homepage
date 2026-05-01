import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { unlockSchema } from "@/lib/relicValidators";
import {
  RELIC_UNLOCK_COOKIE,
  parseUnlockCookie,
  serializeUnlockCookie,
  unlockCookieOptions,
} from "@/lib/relicCookie";

const FAIL_DELAY_MS = 600;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0]?.trim() || "unknown").slice(0, 64);
}

function rateLimited(key: string): boolean {
  const now = Date.now();
  const cur = attempts.get(key);
  if (!cur || cur.resetAt < now) {
    attempts.set(key, { count: 0, resetAt: now + WINDOW_MS });
    return false;
  }
  return cur.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string) {
  const cur = attempts.get(key);
  if (cur) cur.count += 1;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = unlockSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const key = clientKey(req);
  if (rateLimited(key)) {
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.json({ error: "too-many-attempts" }, { status: 429 });
  }

  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, rarity: true, passwordHash: true },
  });
  if (!relic || relic.rarity !== "SPECIAL" || !relic.passwordHash) {
    recordFailure(key);
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.json({ error: "incorrect" }, { status: 401 });
  }

  const ok = await bcrypt.compare(parsed.data.password, relic.passwordHash);
  if (!ok) {
    recordFailure(key);
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.json({ error: "incorrect" }, { status: 401 });
  }

  attempts.delete(key);
  const jar = await cookies();
  const existing = parseUnlockCookie(jar.get(RELIC_UNLOCK_COOKIE)?.value);
  existing.add(relic.id);
  jar.set(RELIC_UNLOCK_COOKIE, serializeUnlockCookie(existing), unlockCookieOptions());
  return NextResponse.json({ ok: true });
}
