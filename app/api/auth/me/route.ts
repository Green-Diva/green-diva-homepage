import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, getCurrentUser } from "@/lib/auth";

export async function GET() {
  const u = await getCurrentUser();
  if (!u) {
    // stale cookie cleanup
    (await cookies()).delete(SESSION_COOKIE);
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({
    user: {
      id: u.id,
      name: u.name,
      level: u.level,
      gender: u.gender,
      avatarUrl: u.avatarUrl,
    },
  });
}
