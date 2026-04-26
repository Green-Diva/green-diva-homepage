import "server-only";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

export const SESSION_COOKIE = "gd_session";
export const ADMIN_LEVEL = 100;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7d
const RENEW_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 2; // 2d

export type CurrentUser = {
  id: string;
  name: string;
  level: number;
  token: string;
  gender: string | null;
  avatarUrl: string | null;
  bio: string | null;
  attack: number;
  defense: number;
  hp: number;
  agility: number;
  luck: number;
  specialAttributes: string | null;
};

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

export function generateToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await prisma.session.create({
    data: { userId, expiresAt },
    select: { id: true, expiresAt: true },
  });
  return session;
}

export async function destroySession(sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sid) return null;

  const session = await prisma.session.findUnique({
    where: { id: sid },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: sid } }).catch(() => { });
    return null;
  }

  // sliding renewal
  const remaining = session.expiresAt.getTime() - Date.now();
  if (remaining < RENEW_THRESHOLD_MS) {
    await prisma.session
      .update({
        where: { id: sid },
        data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      })
      .catch(() => { });
  }

  const u = session.user;
  return {
    id: u.id,
    name: u.name,
    level: u.level,
    token: u.token,
    gender: u.gender,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    attack: u.attack,
    defense: u.defense,
    hp: u.hp,
    agility: u.agility,
    luck: u.luck,
    specialAttributes: u.specialAttributes,
  };
}

export function isAdmin(u: CurrentUser | null): boolean {
  return !!u && u.level >= ADMIN_LEVEL;
}

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) throw new AuthError(401, "Unauthorized");
  return u;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) throw new AuthError(401, "Unauthorized");
  if (u.level < ADMIN_LEVEL) throw new AuthError(403, "Forbidden");
  return u;
}
