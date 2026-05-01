import "server-only";
import { cookies } from "next/headers";
import type { Rarity } from "@prisma/client";
import { ADMIN_LEVEL, type CurrentUser } from "@/lib/auth";
import { RELIC_UNLOCK_COOKIE, parseUnlockCookie } from "@/lib/relicCookie";

export const RARITY_GATE: Record<Exclude<Rarity, "SPECIAL">, number> = {
  COMMON: 0,
  RARE: 25,
  EPIC: 50,
  LEGENDARY: 75,
};

export type AccessResult =
  | { ok: true; reason: "admin" | "unlocked" | "level" | "shared" }
  | { ok: false; reason: "needs-level"; required: number }
  | { ok: false; reason: "needs-password" };

export interface RelicAccessShape {
  id: string;
  rarity: Rarity;
}

export function canAccessRelic(
  relic: RelicAccessShape,
  user: Pick<CurrentUser, "level"> | null,
  unlockedIds: Set<string>,
  sharedIds: Set<string> = new Set(),
): AccessResult {
  const level = user?.level ?? 0;
  if (level >= ADMIN_LEVEL) return { ok: true, reason: "admin" };
  if (sharedIds.has(relic.id)) return { ok: true, reason: "shared" };
  if (relic.rarity === "SPECIAL") {
    return unlockedIds.has(relic.id)
      ? { ok: true, reason: "unlocked" }
      : { ok: false, reason: "needs-password" };
  }
  const required = RARITY_GATE[relic.rarity];
  return level >= required
    ? { ok: true, reason: "level" }
    : { ok: false, reason: "needs-level", required };
}

export async function getUnlockedRelicIds(): Promise<Set<string>> {
  const jar = await cookies();
  return parseUnlockCookie(jar.get(RELIC_UNLOCK_COOKIE)?.value);
}
