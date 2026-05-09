// End-to-end smoke for the Phase-5+ relic scribe agent.
// Run: npx tsx scripts/test-scribe-flow.ts
//
// Walks through:
//   1. invokeAgent({mode:"initial"}) on an existing READY relic — exercises
//      summary → research → pick (Gemini + SerpAPI optional).
//   2. (skip) regen mode — needs lore already in DB; usually verified via UI.
//   3. (skip) 2dEnhance — requires FAL_API_KEY; logs warning if absent.
//   4. (skip) 3dCreate — Meshy ~3min, manual UI verification only.

import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

import { PrismaClient } from "@prisma/client";
import { invokeAgent } from "@/lib/agents/invoke";

const prisma = new PrismaClient();

async function main() {
  console.log("env check:");
  for (const k of ["GEMINI_API_KEY", "FAL_API_KEY", "SERPAPI_KEY", "MESHY_API_KEY"]) {
    console.log(`  ${k}:`, process.env[k] ? "set" : "MISSING");
  }

  const agent = await prisma.agent.findUnique({
    where: { codename: "RELIC-SCRIBE-001" },
  });
  if (!agent) throw new Error("RELIC-SCRIBE-001 missing — run prisma/seed-relic-scribe-agent.ts");

  // Find a "vault-*" relic — those came through the upload pipeline and
  // have extracted/ files on disk, unlike the seed-data relics like
  // "access-key" which were created before the pipeline existed.
  const relic = await prisma.relic.findFirst({
    where: {
      slug: { startsWith: "vault-" },
      status: { in: ["READY", "AWAITING_REVIEW", "PARTIAL"] },
    },
    orderBy: { slot: "desc" },
    select: { id: true, slug: true, nameEn: true },
  });
  if (!relic) {
    console.log("No suitable relic — upload one via /relic-collection first.");
    return;
  }
  console.log(`\n--- [1/1] mode:initial on relic: ${relic.slug} (${relic.nameEn}) ---`);

  const r = await invokeAgent({
    agent,
    mode: agent.mode,
    input: { mode: "initial", relicSlug: relic.slug },
  });

  if (!r.ok) {
    console.error("FAIL:", r.errorCode, r.errorMessage);
    console.error("runLog:");
    for (const e of r.runLog) {
      const tag = e.skipped ? "○ SKIP" : e.ok ? "✓ OK  " : "✕ FAIL";
      console.error(`  ${tag} ${e.stepId}${e.errorCode ? ` (${e.errorCode})` : ""} ${e.durationMs}ms`);
    }
    process.exit(1);
  }

  console.log("OK. runLog:");
  for (const e of r.runLog) {
    const tag = e.skipped ? "○ SKIP" : e.ok ? "✓ OK  " : "✕ FAIL";
    console.log(`  ${tag} ${e.stepId} (${e.durationMs}ms)`);
  }

  console.log("\nFinal output (truncated):");
  const summary =
    typeof r.output === "object" && r.output !== null
      ? Object.fromEntries(
          Object.entries(r.output as Record<string, unknown>).map(([k, v]) => [
            k,
            typeof v === "string" ? v.slice(0, 80) : v,
          ]),
        )
      : r.output;
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((e) => {
    console.error("UNEXPECTED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
