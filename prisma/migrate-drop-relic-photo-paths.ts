// Drops Relic.photoPaths — legacy manual multi-photo field removed from
// runtime/UI. Idempotent and safe to re-run.
//
// Per repo convention, destructive schema changes are handled via explicit
// pre-db-push scripts rather than relying solely on --accept-data-loss.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    console.log("[migrate-drop-relic-photo-paths] start");
    await prisma.$executeRawUnsafe(
        `ALTER TABLE "Relic" DROP COLUMN IF EXISTS "photoPaths"`,
    );
    console.log("[migrate-drop-relic-photo-paths] done");
}

main()
    .catch((e) => {
        console.error("[migrate-drop-relic-photo-paths] FAILED", e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
