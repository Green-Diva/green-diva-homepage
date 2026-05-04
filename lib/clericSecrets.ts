import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

/**
 * Encrypted-at-rest storage for capability API keys (Anthropic / remove.bg /
 * Tavily / Meshy / etc.). Admins write these via the UI; capabilities read via
 * `getSecretOrEnv` which prefers DB over .env (DB > env priority).
 *
 * Encryption: AES-256-GCM. The 32-byte KEK is derived deterministically from
 * AGENT_SECRETS_KEK if set, otherwise falls back to SAFETY_SECRET. The
 * fallback keeps small deployments zero-config; production-grade setups can
 * isolate KEK rotation from session/cookie rotation by setting AGENT_SECRETS_KEK
 * to its own >=32-byte value (openssl rand -base64 32).
 *
 * Rotating whichever env actually serves as the seed invalidates all stored
 * ciphertexts (forces admins to re-enter API keys via the UI).
 */

let cachedKek: Buffer | null = null;
function getKek(): Buffer {
  if (cachedKek) return cachedKek;
  const seed = process.env.AGENT_SECRETS_KEK || process.env.SAFETY_SECRET;
  if (!seed || seed.length < 16) {
    throw new Error(
      "AGENT_SECRETS_KEK (or SAFETY_SECRET fallback) missing or too short (>=16 chars)",
    );
  }
  cachedKek = createHash("sha256").update("agent-secret-v1\0" + seed).digest();
  return cachedKek;
}

function encrypt(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKek(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decrypt(parts: { ciphertext: string; iv: string; authTag: string }): string {
  const decipher = createDecipheriv("aes-256-gcm", getKek(), Buffer.from(parts.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parts.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(parts.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export async function setSecret(
  name: string,
  value: string,
  actorUserId: string | null,
): Promise<void> {
  if (!value || value.length === 0) {
    throw new Error("empty secret value");
  }
  const enc = encrypt(value);
  const hint = value.length <= 4 ? "••••" : value.slice(-4);
  await prisma.agentSecret.upsert({
    where: { name },
    create: {
      name,
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      hint,
      createdById: actorUserId,
    },
    update: {
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      hint,
      createdById: actorUserId,
    },
  });
}

export async function deleteSecret(name: string): Promise<void> {
  await prisma.agentSecret.delete({ where: { name } }).catch(() => {
    // already gone or never existed — idempotent
  });
}

/**
 * Returns plaintext if a DB row exists; null otherwise. Capability code should
 * normally use `getSecretOrEnv` instead so .env is honoured as a fallback.
 */
export async function getDbSecret(name: string): Promise<string | null> {
  const row = await prisma.agentSecret.findUnique({ where: { name } });
  if (!row) return null;
  try {
    return decrypt(row);
  } catch (e) {
    console.error("[agentSecrets] decrypt failed; secret unusable", { name, e });
    return null;
  }
}

/**
 * DB > .env priority. Use this everywhere capabilities currently read
 * `process.env.X` for an API key.
 */
export async function getSecretOrEnv(name: string): Promise<string | null> {
  const fromDb = await getDbSecret(name);
  if (fromDb) return fromDb;
  const fromEnv = process.env[name];
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

export type ConfiguredSecretSource = "db" | "env" | "none";

export type ConfiguredSecret = {
  name: string;
  source: ConfiguredSecretSource;
  hint: string | null;
  updatedAt: string | null;
};

/**
 * Batch-readiness check used by the capability summary helper. Returns a Set
 * of `name`s that resolve to a non-empty value (DB or env). Single DB query
 * regardless of how many names you ask about.
 */
export async function getConfiguredSecretNames(names: string[]): Promise<Set<string>> {
  if (names.length === 0) return new Set();
  const rows = await prisma.agentSecret.findMany({
    where: { name: { in: names } },
    select: { name: true },
  });
  const out = new Set<string>(rows.map((r) => r.name));
  for (const n of names) {
    const v = process.env[n];
    if (v && v.length > 0) out.add(n);
  }
  return out;
}

/**
 * Admin listing endpoint backing data. Never exposes ciphertext or plaintext —
 * just configuration status + a hint suffix for UI affordance.
 */
export async function listSecretStatus(names: string[]): Promise<ConfiguredSecret[]> {
  const rows = await prisma.agentSecret.findMany({
    where: { name: { in: names } },
    select: { name: true, hint: true, updatedAt: true },
  });
  const byName = new Map(rows.map((r) => [r.name, r]));
  return names.map((name) => {
    const dbRow = byName.get(name);
    if (dbRow) {
      return {
        name,
        source: "db" as const,
        hint: dbRow.hint,
        updatedAt: dbRow.updatedAt.toISOString(),
      };
    }
    const fromEnv = process.env[name];
    if (fromEnv && fromEnv.length > 0) {
      return {
        name,
        source: "env" as const,
        hint: fromEnv.length <= 4 ? "••••" : fromEnv.slice(-4),
        updatedAt: null,
      };
    }
    return { name, source: "none" as const, hint: null, updatedAt: null };
  });
}
