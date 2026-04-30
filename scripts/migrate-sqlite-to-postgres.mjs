// One-off: copy User + Activity rows from local SQLite to the Postgres
// referenced by env DATABASE_URL. Skips Session (cookies will be re-issued).
//
// Usage:
//   DATABASE_URL="postgresql://..." node scripts/migrate-sqlite-to-postgres.mjs
//
// The DATABASE_URL above must point to PG (Railway DATABASE_PUBLIC_URL is fine
// for this one-time run). The script uses Prisma client which the project
// already has configured for postgresql provider.

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlitePath = path.resolve(__dirname, "../prisma/dev.db");

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith("postgres")) {
  console.error("DATABASE_URL must be a postgres URL. Got:", process.env.DATABASE_URL);
  process.exit(1);
}

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const prisma = new PrismaClient();

function rowToUser(r) {
  return {
    id: r.id,
    serial: r.serial ?? null,
    token: r.token,
    name: r.name,
    gender: r.gender ?? null,
    avatarUrl: r.avatarUrl ?? null,
    bio: r.bio ?? null,
    level: r.level,
    attack: r.attack,
    defense: r.defense,
    hp: r.hp,
    agility: r.agility,
    luck: r.luck,
    specialAttributes: r.specialAttributes ?? null,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  };
}

function rowToActivity(r) {
  return {
    id: r.id,
    userId: r.userId,
    content: r.content,
    createdAt: new Date(r.createdAt),
  };
}

const users = sqlite.prepare(`SELECT * FROM "User"`).all().map(rowToUser);
const activities = sqlite.prepare(`SELECT * FROM "Activity"`).all().map(rowToActivity);

console.log(`Found ${users.length} users, ${activities.length} activities in SQLite`);

let userInserted = 0;
let userUpdated = 0;
for (const u of users) {
  const existing = await prisma.user.findUnique({ where: { id: u.id } });
  if (existing) {
    await prisma.user.update({ where: { id: u.id }, data: u });
    userUpdated += 1;
  } else {
    await prisma.user.create({ data: u });
    userInserted += 1;
  }
}

let actInserted = 0;
let actSkipped = 0;
for (const a of activities) {
  const existing = await prisma.activity.findUnique({ where: { id: a.id } });
  if (existing) {
    actSkipped += 1;
    continue;
  }
  await prisma.activity.create({ data: a });
  actInserted += 1;
}

console.log(`Users: inserted ${userInserted}, updated ${userUpdated}`);
console.log(`Activities: inserted ${actInserted}, skipped ${actSkipped}`);

await prisma.$disconnect();
sqlite.close();
