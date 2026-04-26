import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken && adminToken !== "change-me-to-a-long-random-string") {
    await prisma.user.upsert({
      where: { token: adminToken },
      update: { level: 100, name: "High Lord" },
      create: {
        token: adminToken,
        serial: 1,
        name: "High Lord",
        level: 100,
        attack: 82,
        defense: 74,
        hp: 90,
        agility: 66,
        luck: 78,
        specialAttributes: "Sigil-bound · Vault-keeper · Architect",
      },
    });
    console.log("Seeded High Lord (level 100) from ADMIN_TOKEN");
  } else {
    console.warn("ADMIN_TOKEN not set or default; skipping High Priestess seed");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
