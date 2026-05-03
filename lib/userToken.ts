import "server-only";
import { createHmac } from "node:crypto";
import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

function getSecret(): string {
  const s = process.env.SAFETY_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SAFETY_SECRET missing or too short (>=16 chars) — required for token lookup");
  }
  return s;
}

export function deriveTokenLookup(token: string): string {
  return createHmac("sha256", getSecret()).update(token).digest("base64url");
}

export async function hashToken(token: string): Promise<string> {
  return bcrypt.hash(token, BCRYPT_COST);
}

export async function verifyToken(token: string, hash: string): Promise<boolean> {
  return bcrypt.compare(token, hash);
}

export const MASKED_TOKEN = "••••";
