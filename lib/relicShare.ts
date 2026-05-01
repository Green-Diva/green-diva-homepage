import "server-only";
import { prisma } from "@/lib/db";

export async function getSharedRelicIds(userId: string | null | undefined): Promise<Set<string>> {
  if (!userId) return new Set();
  const rows = await prisma.relicShare.findMany({
    where: { userId },
    select: { relicId: true },
  });
  return new Set(rows.map((r) => r.relicId));
}
