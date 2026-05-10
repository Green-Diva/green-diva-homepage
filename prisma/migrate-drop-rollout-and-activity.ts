// One-shot pre-push migration (2026-05-10): drop the SceneBinding staged-
// rollout columns and the AgentJob Activity-tab telemetry columns. Both
// were Phase 6.2 / Phase 7 additions that never had a real caller —
// removing them shrinks dispatch.ts, deletes ActivityPanel + the
// /api/agent-jobs list endpoint, and removes one Json-shape concern from
// the Scenes editor.
//
// Idempotent: each ALTER uses IF EXISTS / IF NOT EXISTS guards.
//
// Required env: DATABASE_URL.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // SceneBinding rollout fields.
  await prisma.$executeRawUnsafe(`ALTER TABLE "SceneBinding" DROP COLUMN IF EXISTS "rolloutPct"`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "SceneBinding" DROP COLUMN IF EXISTS "fallbackAgentId"`);

  // AgentJob Activity telemetry columns. sceneKey is intentionally kept
  // (runner.ts reads it to derive the relic processing-log phase); the
  // index that covered (sceneKey, createdAt) is dropped because no UI
  // queries it anymore. The remaining @@index([agentId, createdAt]) is
  // sufficient for job lookup by agent.
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "AgentJob_sceneKey_createdAt_idx"`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "AgentJob" DROP COLUMN IF EXISTS "actorUserId"`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "AgentJob" DROP COLUMN IF EXISTS "actorName"`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "AgentJob" DROP COLUMN IF EXISTS "routedTo"`);

  console.log("[migrate-drop-rollout-and-activity] done");
}

main()
  .catch((e) => {
    console.error("[migrate-drop-rollout-and-activity] FAILED", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
