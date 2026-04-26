import { NextResponse } from "next/server";
import { LOCALES, LOCALE_COOKIE, type Locale } from "@/lib/i18n/types";

export async function POST(req: Request) {
  const { locale } = (await req.json().catch(() => ({}))) as { locale?: string };
  if (!locale || !(LOCALES as string[]).includes(locale)) {
    return NextResponse.json({ error: "invalid locale" }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true, locale });
  res.cookies.set(LOCALE_COOKIE, locale as Locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return res;
}
