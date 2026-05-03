import "server-only";
import { prisma } from "@/lib/db";
import { runRelicPipeline } from "@/lib/relics/pipeline";

const STALE_MS = 10 * 60 * 1000;

let initPromise: Promise<void> | null = null;

/**
 * Lazy server-side init. Call from API route handlers that touch the relic
 * pipeline (draft create / job poll / retry). Idempotent: subsequent calls
 * resolve immediately from the memoised promise.
 *
 * Currently does one thing: resume jobs left in RUNNING state by a previous
 * process (server restart / crash). Anything updated more than 10 minutes ago
 * is considered abandoned and re-fired.
 */
export function ensureServerInit(): Promise<void> {
  if (!initPromise) {
    initPromise = init().catch((e) => {
      console.error("[server-init] failed", e);
      // Reset so a later request can retry the init.
      initPromise = null;
    });
  }
  return initPromise;
}

async function init(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  const stale = await prisma.relicProcessingJob.findMany({
    where: { status: "RUNNING", updatedAt: { lt: cutoff } },
    select: { id: true, step: true },
  });
  if (stale.length === 0) return;

  console.warn(
    `[server-init] resuming ${stale.length} stale RUNNING job(s) older than ${STALE_MS / 1000}s`,
  );
  await prisma.relicProcessingJob.updateMany({
    where: { id: { in: stale.map((j) => j.id) } },
    data: { status: "PENDING", errorMessage: "auto-resumed after server restart" },
  });
  for (const job of stale) {
    void runRelicPipeline(job.id, { fromStep: job.step }).catch((e) => {
      console.error(`[server-init] resumed pipeline crashed for ${job.id}`, e);
    });
  }
}
