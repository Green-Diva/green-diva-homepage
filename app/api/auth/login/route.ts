import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { loginSchema } from "@/lib/validators";
import { SESSION_COOKIE, createSession, sessionCookieOptions } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n/server";

const FAIL_DELAY_MS = 600;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: NextRequest): string {
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

export async function POST(req: NextRequest) {
  const t = await getDictionary();
  const key = clientKey(req);
  if (rateLimited(key)) {
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  const json = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: t.errors.invalidRequest }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { token: parsed.data.token } });
  if (!user) {
    recordFailure(key);
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.json(
      { error: t.errors.invalidToken },
      { status: 401 },
    );
  }

  attempts.delete(key);
  const session = await createSession(user.id);
  (await cookies()).set(SESSION_COOKIE, session.id, sessionCookieOptions());

  return NextResponse.json({
    user: { id: user.id, name: user.name, level: user.level },
  });
}
