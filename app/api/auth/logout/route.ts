import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, destroySession } from "@/lib/auth";

export async function POST() {
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  if (sid) {
    await destroySession(sid).catch(() => {});
  }
  jar.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
