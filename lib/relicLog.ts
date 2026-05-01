import "server-only";
import { Prisma, type RelicAction } from "@prisma/client";
import { prisma } from "@/lib/db";

type RelicSnapshot = {
  id: string;
  slug: string;
  name: string; // pick whichever locale you want as the snapshot
};

type Actor = {
  id: string;
  name: string;
};

type Target = {
  id: string;
  name: string;
} | null;

export async function recordRelicLog(args: {
  action: RelicAction;
  relic: RelicSnapshot;
  actor: Actor | null;
  target?: Target;
  notes?: string | null;
  details?: Prisma.InputJsonValue | null;
}): Promise<void> {
  try {
    await prisma.relicLog.create({
      data: {
        action: args.action,
        relicId: args.relic.id,
        relicSlug: args.relic.slug,
        relicNameSnapshot: args.relic.name,
        actorId: args.actor?.id ?? null,
        actorNameSnapshot: args.actor?.name ?? null,
        targetUserId: args.target?.id ?? null,
        targetNameSnapshot: args.target?.name ?? null,
        notes: args.notes ?? null,
        details: args.details ?? Prisma.JsonNull,
      },
    });
  } catch (e) {
    // Logging must never break the primary operation.
    console.error("[relicLog] failed to record", { action: args.action, relicId: args.relic.id, e });
  }
}

