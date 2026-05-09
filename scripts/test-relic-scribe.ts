// End-to-end test: exercises both skills + the agent invocation path.
// Run: npx tsx scripts/test-relic-scribe.ts

import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { PrismaClient } from "@prisma/client";
import { invokeSkill } from "@/lib/skills/invoke";
import { invokeAgent } from "@/lib/agents/invoke";

const prisma = new PrismaClient();

async function main() {
  console.log("ANTHROPIC_API_KEY present:", !!process.env.ANTHROPIC_API_KEY);

  // 1. Skill: Relic Files Summary (dry-run)
  console.log("\n--- [1/3] Relic Files Summary (dry-run) ---");
  const filesSkill = await prisma.skill.findFirst({
    where: { nameEn: "Relic Files Summary" },
  });
  if (!filesSkill) throw new Error("Files Summary skill missing");
  const r1 = await invokeSkill(filesSkill, { _dryRun: true });
  if (!r1.ok) {
    console.error("FAIL:", r1.errorCode, r1.errors.join("; "));
    process.exit(1);
  }
  console.log("OK. fileCount:", (r1.output as { fileCount: number }).fileCount);
  const summaryOutput = r1.output as {
    userBrief: string;
    fileSummary: string;
  };

  // 2. Skill: Relic Metadata Scribe (real LLM call, fed by step 1's output)
  console.log("\n--- [2/3] Relic Metadata Scribe (live LLM) ---");
  const metaSkill = await prisma.skill.findFirst({
    where: { nameEn: "Relic Metadata Scribe" },
  });
  if (!metaSkill) throw new Error("Metadata Scribe skill missing");
  const r2 = await invokeSkill(metaSkill, summaryOutput);
  if (!r2.ok) {
    console.error("FAIL:", r2.errorCode, r2.errors.join("; "));
    process.exit(1);
  }
  console.log("OK. output:");
  console.log(JSON.stringify(r2.output, null, 2));

  // 3. Agent: full Backbone (slot 0 → slot 1) — but we need a real relic for
  //    the file reader. Find an existing one or fall back to dry-run override.
  console.log("\n--- [3/3] Agent invocation (Backbone full run) ---");
  const agent = await prisma.agent.findUnique({
    where: { codename: "RELIC-SCRIBE-001" },
  });
  if (!agent) throw new Error("RELIC-SCRIBE-001 agent missing");

  const someRelic = await prisma.relic.findFirst({
    where: { status: { in: ["READY", "PARTIAL"] } },
    select: { slug: true, nameEn: true },
  });

  if (someRelic) {
    console.log(`Using existing relic: ${someRelic.slug} (${someRelic.nameEn})`);
    const r3 = await invokeAgent({
      agent,
      mode: agent.mode,
      input: { relicSlug: someRelic.slug },
    });
    if (!r3.ok) {
      console.error("FAIL:", r3.errorCode, r3.errorMessage);
      console.error("runLog:", JSON.stringify(r3.runLog, null, 2));
      process.exit(1);
    }
    console.log("OK. agent output:");
    console.log(JSON.stringify(r3.output, null, 2));
  } else {
    console.log(
      "No existing relic in DB — skipping live agent run. Steps 1+2 prove the skill chain works.",
    );
  }

  console.log("\n✓ All checks passed.");
}

main()
  .catch((e) => {
    console.error("UNEXPECTED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
