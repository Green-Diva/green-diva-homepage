import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { loginSchema } from "@/lib/validators";
import { SESSION_COOKIE, createSession, sessionCookieOptions } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n/server";

export async function POST(req: NextRequest) {
  const t = await getDictionary();
  const json = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: t.errors.invalidRequest }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { token: parsed.data.token } });
  if (!user) {
    return NextResponse.json(
      { error: t.errors.invalidToken },
      { status: 401 },
    );
  }

  const session = await createSession(user.id);
  (await cookies()).set(SESSION_COOKIE, session.id, sessionCookieOptions());

  return NextResponse.json({
    user: { id: user.id, name: user.name, level: user.level },
  });
}
