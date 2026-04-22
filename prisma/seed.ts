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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
