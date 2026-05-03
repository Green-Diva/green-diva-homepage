// One-shot migration: rehash legacy plaintext User.token into bcrypt
// User.tokenHash + HMAC User.tokenLookup. Safe to re-run; bails out
// once the old "token" column no longer exists.
//
// Required env: DATABASE_URL, SAFETY_SECRET (>=16 chars).
// Runs before `prisma db push` in start command — once it succeeds,
// the schema matches and db push becomes a no-op.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHmac } from "node:crypto";

const BCRYPT_COST = 12;

function deriveLookup(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("base64url");
}

async function main() {
  const secret = process.env.SAFETY_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SAFETY_SECRET missing or <16 chars — required for token lookup");
  }

  const prisma = new PrismaClient();
  try {
    const exists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'User' AND column_name = 'token'
       ) AS exists`
    );
    if (!exists[0]?.exists) {
      console.log("[migrate-token] legacy token column absent — skip");
      return;
    }
    console.log("[migrate-token] legacy token column detected — migrating");

    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenHash" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenLookup" TEXT`);

    const rows = await prisma.$queryRawUnsafe<{ id: string; token: string }[]>(
      `SELECT id, token FROM "User" WHERE token IS NOT NULL`
    );
    console.log(`[migrate-token] rehashing ${rows.length} user(s)`);
    for (const r of rows) {
      const hash = await bcrypt.hash(r.token, BCRYPT_COST);
      const lookup = deriveLookup(r.token, secret);
      await prisma.$executeRawUnsafe(
        `UPDATE "User" SET "tokenHash" = $1, "tokenLookup" = $2 WHERE id = $3`,
        hash,
        lookup,
        r.id
      );
    }

    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ALTER COLUMN "tokenHash" SET NOT NULL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ALTER COLUMN "tokenLookup" SET NOT NULL`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "User_tokenLookup_key" ON "User"("tokenLookup")`
    );
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" DROP COLUMN IF EXISTS "token"`);

    console.log("[migrate-token] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-token] failed:", e);
  process.exit(1);
});
