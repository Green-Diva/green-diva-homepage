// Internal service token — HMAC-derived from SAFETY_SECRET so two parts
// of the same Node process can verify they're talking to themselves
// without admin maintaining yet another env var.
//
// Use case: HTTP_API skill handlers calling the main app's
// /api/internal/* endpoints (save-asset, files-summary, …) need an auth
// header. We don't want admin to set a separate INTERNAL_SERVICE_TOKEN
// env, so we derive one deterministically from SAFETY_SECRET (which is
// already required and ≥32 bytes per CLAUDE.md). The same derivation
// happens on both ends:
//   - server-init.ts sets process.env.INTERNAL_SERVICE_TOKEN at boot
//   - /api/internal/* endpoints call verifyInternalToken(req) per request
//
// Rotating SAFETY_SECRET rotates this too — fine, since SAFETY_SECRET
// rotation already invalidates user cookies; one more knock-on is
// acceptable. Skill rows that use authEnv: "INTERNAL_SERVICE_TOKEN"
// keep working without DB changes (env value just changes).

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_PURPOSE = "internal-api:v1";
const HEADER_NAME = "x-internal-token";

let cachedToken: string | null = null;

function readSafetySecret(): string {
  const s = process.env.SAFETY_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "SAFETY_SECRET is not set or too short — refusing to derive internal token. " +
        "Set SAFETY_SECRET to at least 32 random bytes (`openssl rand -base64 32`).",
    );
  }
  return s;
}

/**
 * Derive (and cache) the internal service token. Idempotent — same value
 * for the same SAFETY_SECRET. Safe to call from request handlers.
 */
export function getInternalServiceToken(): string {
  if (cachedToken) return cachedToken;
  const secret = readSafetySecret();
  cachedToken = createHmac("sha256", secret).update(TOKEN_PURPOSE).digest("hex");
  return cachedToken;
}

/**
 * Constant-time check that `header` matches the derived service token.
 * Returns false on length mismatch (which would cause timingSafeEqual to
 * throw) or any other validation failure.
 */
export function verifyInternalServiceToken(header: string | null | undefined): boolean {
  if (typeof header !== "string" || header.length === 0) return false;
  let expected: string;
  try {
    expected = getInternalServiceToken();
  } catch {
    return false;
  }
  if (header.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(header, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}

export const INTERNAL_TOKEN_HEADER = HEADER_NAME;
