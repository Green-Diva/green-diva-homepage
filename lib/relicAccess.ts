import "server-only";
import { cookies } from "next/headers";
import type { Rarity } from "@prisma/client";
import { ADMIN_LEVEL, type CurrentUser } from "@/lib/auth";
import { RELIC_UNLOCK_COOKIE, parseUnlockCookie } from "@/lib/relicCookie";

export type AccessLevel = "RED" | "YELLOW" | "GREEN";

// View threshold per rarity. SPECIAL bypasses level entirely.
// Extract right is never auto-granted by level — always requires admin grant.
export const RARITY_GATES: Record<Rarity, { view: number }> = {
  COMMON: { view: 10 },
  RARE: { view: 25 },
  EPIC: { view: 50 },
  LEGENDARY: { view: 85 },
  SPECIAL: { view: Number.POSITIVE_INFINITY },
};

export type AccessReason =
  | "admin"
  | "granted"
  | "level-view"
  | "shared"
  | "unlocked"
  | "locked-level"
  | "locked-password";

export type AccessResult = {
  level: AccessLevel;
  reason: AccessReason;
  required?: number;
};

export interface RelicAccessShape {
  id: string;
  rarity: Rarity;
}

export function canAccessRelic(
  relic: RelicAccessShape,
  user: Pick<CurrentUser, "id" | "level"> | null,
  unlockedIds: Set<string>,
  sharedIds: Set<string> = new Set(),
  grantedIds: Set<string> = new Set(),
): AccessResult {
  const level = user?.level ?? 0;

  if (level >= ADMIN_LEVEL) return { level: "GREEN", reason: "admin" };
  if (grantedIds.has(relic.id)) return { level: "GREEN", reason: "granted" };

  const gate = RARITY_GATES[relic.rarity];
  if (relic.rarity !== "SPECIAL") {
    if (level >= gate.view) return { level: "YELLOW", reason: "level-view" };
  }

  if (unlockedIds.has(relic.id)) return { level: "YELLOW", reason: "unlocked" };
  if (sharedIds.has(relic.id)) return { level: "YELLOW", reason: "shared" };

  if (relic.rarity === "SPECIAL") return { level: "RED", reason: "locked-password" };
  return { level: "RED", reason: "locked-level", required: gate.view };
}

export async function getUnlockedRelicIds(): Promise<Set<string>> {
  const jar = await cookies();
  return parseUnlockCookie(jar.get(RELIC_UNLOCK_COOKIE)?.value);
}
