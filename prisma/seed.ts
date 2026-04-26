import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const projects = [
    {
      slug: "japan-invoice-scanner",
      title: "Japan Invoice Scanner",
      summary: "Multi-model OCR service cross-validating invoice amounts from Japanese receipts.",
      description:
        "# Japan Invoice Scanner\n\nA FastAPI service that extracts structured data from Japanese invoices by cross-validating outputs from Gemini, GPT, and Claude vision models.\n\n## Highlights\n- Async model fanout\n- Amount reconciliation with confidence scoring\n- Single-port SPA + API",
      coverUrl: null,
      tags: "FastAPI,OCR,Gemini,GPT,Claude",
      link: null,
      repoUrl: "https://github.com/CongoKim/01-Japan-Invoice-Scanner",
      order: 1,
      published: true,
    },
    {
      slug: "green-diva-workbook",
      title: "Green Diva Workbook",
      summary: "Monorepo-style sandbox grouping exploratory projects, each deployed independently.",
      description:
        "# Green Diva Workbook\n\nA personal monorepo. Each sub-project lives in its own Git repo and is deployed independently (Railway / Vercel). Shared conventions in a top-level CLAUDE.md.",
      coverUrl: null,
      tags: "Monorepo,DX,Tooling",
      link: null,
      repoUrl: null,
      order: 2,
      published: true,
    },
    {
      slug: "personal-webpage",
      title: "Personal Webpage",
      summary: "This site — Next.js 15 App Router, Prisma, Tailwind v4, token-gated admin CRUD.",
      description:
        "# Personal Webpage\n\nThe site you are reading. Built with Next.js App Router, Prisma on SQLite (Postgres in prod), and a small admin panel gated by a static bearer token.",
      coverUrl: null,
      tags: "Next.js,Prisma,Tailwind",
      link: null,
      repoUrl: null,
      order: 3,
      published: true,
    },
  ];

  for (const p of projects) {
    await prisma.project.upsert({
      where: { slug: p.slug },
      update: p,
      create: p,
    });
  }
  console.log(`Seeded ${projects.length} projects`);

  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken && adminToken !== "change-me-to-a-long-random-string") {
    await prisma.user.upsert({
      where: { token: adminToken },
      update: { level: 100, name: "High Lord" },
      create: {
        token: adminToken,
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
