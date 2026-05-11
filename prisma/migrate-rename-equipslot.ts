// Rename `equipSlot` → `slotIndex` inside Agent.pipelineConfig JSON (2026-05-11).
//
// Why: AgentSkillEquip.slotIndex DB column has always been `slotIndex`, but
// the pipelineConfig JSON used `equipSlot` for the same concept. Two names
// for the same thing made grep-debugging painful. We renamed the JSON field
// to `slotIndex` so it matches the DB column.
//
// What this does:
//   For every Agent row with a non-null pipelineConfig, walks the JSON
//   (top-level + loop/forEach body recursion) and renames `equipSlot` →
//   `slotIndex` on every skill-type node (and on v1 step entries).
//
// Idempotent: nodes that already have `slotIndex` and no `equipSlot` are
// untouched. Nodes with both are reconciled (slotIndex wins, equipSlot
// dropped).

import { Prisma, PrismaClient } from "@prisma/client";

type AnyNode = Record<string, unknown> & {
  type?: string;
  equipSlot?: number;
  slotIndex?: number;
  body?: { nodes?: AnyNode[]; edges?: unknown[] };
};

function renameOne(node: AnyNode): { node: AnyNode; changed: boolean } {
  let changed = false;
  let n = node;
  // Skill node + v1 step both have equipSlot at root.
  const hasOld = typeof n.equipSlot === "number";
  const hasNew = typeof n.slotIndex === "number";
  if (hasOld && !hasNew) {
    n = { ...n, slotIndex: n.equipSlot };
    delete (n as Record<string, unknown>).equipSlot;
    changed = true;
  } else if (hasOld && hasNew) {
    // Both present — drop the legacy (slotIndex wins).
    n = { ...n };
    delete (n as Record<string, unknown>).equipSlot;
    changed = true;
  }

  // Recurse into loop / forEach bodies.
  if (n.body && Array.isArray(n.body.nodes)) {
    const walked = walkNodes(n.body.nodes);
    if (walked.changed) {
      n = { ...n, body: { ...n.body, nodes: walked.nodes } };
      changed = true;
    }
  }
  return { node: n, changed };
}

function walkNodes(nodes: AnyNode[]): { nodes: AnyNode[]; changed: boolean } {
  let anyChanged = false;
  const out = nodes.map((n) => {
    const { node, changed } = renameOne(n);
    if (changed) anyChanged = true;
    return node;
  });
  return { nodes: out, changed: anyChanged };
}

function rewritePipelineConfig(cfg: unknown): { cfg: unknown; changed: boolean } {
  if (!cfg || typeof cfg !== "object") return { cfg, changed: false };
  const c = cfg as Record<string, unknown>;

  // v1: { version: 1, steps: [...] }
  if (c.version === 1 && Array.isArray(c.steps)) {
    const walked = walkNodes(c.steps as AnyNode[]);
    if (walked.changed) return { cfg: { ...c, steps: walked.nodes }, changed: true };
    return { cfg, changed: false };
  }

  // v2: { version: 2, nodes: [...], edges: [...] }
  if (c.version === 2 && Array.isArray(c.nodes)) {
    const walked = walkNodes(c.nodes as AnyNode[]);
    if (walked.changed) return { cfg: { ...c, nodes: walked.nodes }, changed: true };
    return { cfg, changed: false };
  }

  return { cfg, changed: false };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Agent') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log("[migrate-rename-equipslot] Agent table absent — skip");
      return;
    }

    const agents = await prisma.agent.findMany({
      where: { pipelineConfig: { not: Prisma.JsonNull } },
      select: { id: true, codename: true, pipelineConfig: true },
    });

    let updated = 0;
    for (const a of agents) {
      const { cfg, changed } = rewritePipelineConfig(a.pipelineConfig);
      if (!changed) continue;
      await prisma.agent.update({
        where: { id: a.id },
        data: { pipelineConfig: cfg as Prisma.InputJsonValue },
      });
      console.log(`[migrate-rename-equipslot] rewrote ${a.codename} (${a.id})`);
      updated++;
    }
    console.log(`[migrate-rename-equipslot] done — rewrote ${updated}/${agents.length} agents`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-rename-equipslot] failed:", e);
  process.exit(1);
});
