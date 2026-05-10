// Phase 5 Round 1 cleanup migration. Runs after the agent-service +
// forge migrations have stabilised. Idempotent.
//
// What it does:
//   1. Adds outputMap to relic.draft-metadata and relic.regen-metadata
//      SceneBindings so the pipeline step / endpoint can read
//      `result.output` directly without poking runLog by node id.
//      (Pipeline-step decoupling — Phase 5 part A.)
//
//   2. Strips RELIC-SCRIBE-001's stale loadout: the cutout (slot 3) +
//      meshy (slot 4) equips and the backbone DAG nodes/edges that
//      reference them. These were left behind in Phase 2.4.1/2.4.2 as
//      a rollback safety net; with the forge agents serving the bound
//      scenes since then, the legacy slots are dead weight.
//
//   3. Drops the 3 now-orphaned Skill rows:
//        - "Relic Background Cutout" (handler relic-cutout)
//        - "Meshy 3D Generator"      (handler meshy-3d)
//        - legacy "Relic Image Pick v1" (handler relic-image-pick)
//      Skill.equips have onDelete: Cascade so equip rows go with them.
//
// Required env: DATABASE_URL.

import { Prisma, PrismaClient } from "@prisma/client";

const SCRIBE_CODENAME = "RELIC-SCRIBE-001";

// outputMap for relic.draft-metadata: pulls research + pick node outputs
// out of runLog and exposes them under stable keys the pipeline step can
// rely on. Falls back to the agent's leaf output if the agent doesn't
// have these specific node IDs (defensive — better than blowing up).
const DRAFT_METADATA_OUTPUT_MAP = {
  research: "{{runLog.byId.research.output}}",
  pick: "{{runLog.byId.pick.output}}",
};

const REGEN_METADATA_OUTPUT_MAP = {
  // The regen mode endpoint reads top-level metadata fields. Expose the
  // research-regen node's output AS the result root.
  titleZh: "{{runLog.byId.research-regen.output.titleZh}}",
  titleEn: "{{runLog.byId.research-regen.output.titleEn}}",
  subtitleZh: "{{runLog.byId.research-regen.output.subtitleZh}}",
  subtitleEn: "{{runLog.byId.research-regen.output.subtitleEn}}",
  icon: "{{runLog.byId.research-regen.output.icon}}",
  rarity: "{{runLog.byId.research-regen.output.rarity}}",
  formKind: "{{runLog.byId.research-regen.output.formKind}}",
};

async function updateBindingOutputMap(
  prisma: PrismaClient,
  sceneKey: string,
  outputMap: Record<string, unknown>,
): Promise<void> {
  const existing = await prisma.sceneBinding.findUnique({ where: { sceneKey } });
  if (!existing) {
    console.log(`[migrate-phase5] no SceneBinding for ${sceneKey} — skip outputMap`);
    return;
  }
  // Idempotent: only update if outputMap differs (compare via JSON stable
  // sort isn't worth it — Prisma equality on JSON is strict; admin may
  // also have hand-edited, in which case we bail to avoid clobbering).
  const current = existing.outputMap;
  if (current && typeof current === "object") {
    // Already has an outputMap — assume admin / prior run set it. Skip.
    console.log(`[migrate-phase5] ${sceneKey} already has outputMap (${Object.keys(current as Record<string, unknown>).length} keys) — skip`);
    return;
  }
  await prisma.sceneBinding.update({
    where: { sceneKey },
    data: { outputMap: outputMap as unknown as Prisma.InputJsonValue },
  });
  console.log(`[migrate-phase5] set outputMap for ${sceneKey}`);
}

type DagNode = { id: string; type?: string; equipSlot?: number; [k: string]: unknown };
type DagEdge = { from: string; to: string; when?: string; [k: string]: unknown };
type DagConfig = { version?: number; nodes?: DagNode[]; edges?: DagEdge[]; [k: string]: unknown };

// Removes specific node IDs + any edges that touch them. Also strips the
// branch-router's `cases` entries that target the dropped labels (cutout
// case/twoD, meshy case/threeD).
function stripScribeStaleNodes(pipeline: DagConfig | null): {
  next: DagConfig | null;
  changed: boolean;
} {
  if (!pipeline || !Array.isArray(pipeline.nodes)) return { next: pipeline, changed: false };
  const dropNodeIds = new Set(["cutout", "meshy"]);
  const dropBranchLabels = new Set(["twoD", "threeD"]);
  const initialNodeCount = pipeline.nodes.length;
  const initialEdgeCount = Array.isArray(pipeline.edges) ? pipeline.edges.length : 0;
  const nextNodes = pipeline.nodes
    .filter((n) => !dropNodeIds.has(n.id))
    .map((n) => {
      // For the mode-router branch node, prune cases targeting the
      // dropped labels too.
      const rawCases = (n as Record<string, unknown>).cases;
      if (n.id === "mode" && Array.isArray(rawCases)) {
        const cases = rawCases as Array<{ label?: string; [k: string]: unknown }>;
        return {
          ...n,
          cases: cases.filter((c) => !dropBranchLabels.has(c.label ?? "")),
        };
      }
      return n;
    });
  const nextEdges = Array.isArray(pipeline.edges)
    ? pipeline.edges.filter((e) => !dropNodeIds.has(e.to) && !dropNodeIds.has(e.from))
    : [];
  const changed =
    nextNodes.length !== initialNodeCount || nextEdges.length !== initialEdgeCount;
  return {
    next: { ...pipeline, nodes: nextNodes, edges: nextEdges },
    changed,
  };
}

async function cleanScribeLoadout(prisma: PrismaClient): Promise<void> {
  const scribe = await prisma.agent.findUnique({
    where: { codename: SCRIBE_CODENAME },
    include: { skillEquips: { include: { skill: true } } },
  });
  if (!scribe) {
    console.log(`[migrate-phase5] ${SCRIBE_CODENAME} not found — skip loadout cleanup`);
    return;
  }

  // 1. Strip pipelineConfig nodes/edges referencing cutout/meshy.
  const { next, changed } = stripScribeStaleNodes(scribe.pipelineConfig as DagConfig | null);
  if (changed) {
    await prisma.agent.update({
      where: { id: scribe.id },
      data: { pipelineConfig: next as unknown as Prisma.InputJsonValue },
    });
    console.log(`[migrate-phase5] stripped cutout+meshy DAG nodes from ${SCRIBE_CODENAME}`);
  } else {
    console.log(`[migrate-phase5] ${SCRIBE_CODENAME} pipelineConfig already clean — skip`);
  }

  // 2. Drop equip rows in slots 3 and 4. Use deleteMany in case of
  // multiple stragglers — ordinarily there's at most one per slot.
  const droppedEquips = await prisma.agentSkillEquip.deleteMany({
    where: {
      agentId: scribe.id,
      slotIndex: { in: [3, 4] },
    },
  });
  if (droppedEquips.count > 0) {
    console.log(`[migrate-phase5] dropped ${droppedEquips.count} stale equip(s) from ${SCRIBE_CODENAME} slots 3/4`);
  }
}

async function dropObsoleteSkills(prisma: PrismaClient): Promise<void> {
  // Keyed by handler slug inside handlerConfig — slug column on Skill
  // can vary (e.g. derived ones); the inner `handler` field is the
  // canonical identifier for INTERNAL handlers.
  const obsoleteHandlers = ["relic-cutout", "meshy-3d", "relic-image-pick"];
  // Use raw SQL because Prisma's JsonFilter doesn't support cross-DB
  // path-equals reliably; SCRIBE-001 doesn't reference these via slug
  // alone (they're INTERNAL with handlerConfig.handler set).
  const rows = await prisma.$queryRawUnsafe<{ id: string; slug: string | null; nameEn: string }[]>(
    `SELECT id, slug, "nameEn" FROM "Skill"
     WHERE "handlerKind" = 'INTERNAL'
       AND "handlerConfig"->>'handler' = ANY($1::text[])`,
    obsoleteHandlers,
  );
  if (rows.length === 0) {
    console.log("[migrate-phase5] no obsolete Skill rows to drop");
    return;
  }
  for (const r of rows) {
    // Cascade drops AgentSkillEquip rows referencing this skill.
    await prisma.skill.delete({ where: { id: r.id } });
    console.log(`[migrate-phase5] dropped obsolete Skill ${r.slug ?? r.id} (${r.nameEn})`);
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await updateBindingOutputMap(prisma, "relic.draft-metadata", DRAFT_METADATA_OUTPUT_MAP);
    await updateBindingOutputMap(prisma, "relic.regen-metadata", REGEN_METADATA_OUTPUT_MAP);
    await cleanScribeLoadout(prisma);
    await dropObsoleteSkills(prisma);
    console.log("[migrate-phase5] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-phase5] failed:", e);
  process.exit(1);
});
