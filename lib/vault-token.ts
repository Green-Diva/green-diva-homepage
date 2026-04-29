import "server-only";

export const VAULT_COOKIE = "gd_vault";
const TTL_MS = 1000 * 60 * 60; // 1h

function getSecret(): string {
  const s = process.env.VAULT_COOKIE_SECRET;
  if (!s || s.length < 16) {
    throw new Error("VAULT_COOKIE_SECRET missing or too short (>=16 chars)");
  }
  return s;
}

function b64urlEncode(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64urlEncode(sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signVaultToken(): Promise<string> {
  const exp = String(Date.now() + TTL_MS);
  const sig = await hmac(exp);
  return `${exp}.${sig}`;
}

export async function verifyVaultToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const idx = token.indexOf(".");
  if (idx < 0) return false;
  const exp = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = await hmac(exp);
  if (!timingSafeEqual(sig, expected)) return false;
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  return true;
}

export function vaultCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(TTL_MS / 1000),
  };
}
