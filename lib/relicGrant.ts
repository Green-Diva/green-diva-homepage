import "server-only";
import { prisma } from "@/lib/db";

export async function getGrantedRelicIds(
  userId: string | null | undefined,
): Promise<Set<string>> {
  if (!userId) return new Set();
  const rows = await prisma.relicGrant.findMany({
    where: { userId },
    select: { relicId: true },
  });
  return new Set(rows.map((r) => r.relicId));
}
