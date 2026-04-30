#!/usr/bin/env node
// Quick connectivity check against the configured DATABASE_URL.
// Usage:
//   DATABASE_URL="postgresql://..." node scripts/check-db.mjs
// Or with Railway: `railway run node scripts/check-db.mjs`

import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}

const masked = url.replace(/\/\/([^:]+):([^@]+)@/, "//$1:****@");
console.log("Target:", masked);

const prisma = new PrismaClient();

try {
  const t0 = Date.now();
  const userCount = await prisma.user.count();
  const sessionCount = await prisma.session.count();
  const activityCount = await prisma.activity.count();
  const ms = Date.now() - t0;
  console.log(`OK in ${ms}ms`);
  console.log(`  User:     ${userCount}`);
  console.log(`  Session:  ${sessionCount}`);
  console.log(`  Activity: ${activityCount}`);
  const sample = await prisma.user.findMany({
    select: { id: true, name: true, level: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  if (sample.length) {
    console.log("Most recent users:");
    for (const u of sample) {
      console.log(
        `  - ${u.name} (level ${u.level}) — ${u.createdAt.toISOString()}`,
      );
    }
  }
} catch (e) {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
