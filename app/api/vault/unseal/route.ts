import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser, AuthError } from "@/lib/auth";
import {
  VAULT_COOKIE,
  signVaultToken,
  vaultCookieOptions,
} from "@/lib/vault-token";

const FAIL_DELAY_MS = 600;
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

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

export async function POST(req: Request) {
  try {
    await requireUser();
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 401;
    return NextResponse.json({ error: "Unauthorized" }, { status });
  }

  const expected = process.env.SECRET_DOOR_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { error: "Vault not configured" },
      { status: 503 },
    );
  }

  const key = clientKey(req);
  if (rateLimited(key)) {
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const password =
    body && typeof body === "object" && "password" in body
      ? String((body as { password: unknown }).password ?? "")
      : "";

  let ok = password.length === expected.length;
  let diff = 0;
  for (let i = 0; i < Math.max(password.length, expected.length); i++) {
    diff |= (password.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  ok = ok && diff === 0;

  if (!ok) {
    recordFailure(key);
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.json({ error: "Denied" }, { status: 401 });
  }

  attempts.delete(key);
  const token = await signVaultToken();
  const jar = await cookies();
  jar.set(VAULT_COOKIE, token, vaultCookieOptions());
  return NextResponse.json({ ok: true });
}
