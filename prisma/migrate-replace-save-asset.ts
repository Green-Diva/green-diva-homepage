// Post-push migration (2026-05-13): rewrite all pipelineConfig DAGs that
// reference the retired save-asset-relic / save-network-asset HTTP_API
// skills, replacing each such skill node with the new `persist` backbone
// primitive node type. Then delete the equipment rows and the skill rows.
//
// Why: save-asset was data-persistence infrastructure dressed up as a
// skill — it called our own /api/internal/save-asset endpoint with an
// HMAC-derived internal token, occupied a skill slot, and broke the
// "skill = external atomic IO" boundary. The persist primitive is
// symmetric with runner's _relicWriteback hook (both are runtime
// infrastructure).
//
// Idempotent: re-runs scan for save-asset-relic / save-network-asset
// references and either rewrite-or-skip; equip + skill deletes are no-ops
// on a clean DB.

import { PrismaClient } from "@prisma/client";

// Includes the bare "save-asset" slug (a legacy predecessor of
// save-asset-relic / save-network-asset that some older databases still
// have equipped on PICKER-FORGE-001's slot 3).
const RETIRED_SKILL_SLUGS = ["save-asset", "save-asset-relic", "save-network-asset"];

type RawNode = Record<string, unknown>;

function isObject(v: unknown): v is RawNode {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Rewrite a single DAG node array in place. Returns true iff any node was
 * rewritten. Recurses into loop / forEach body sub-DAGs.
 *
 * Note: We rewrite by `slotIndex` membership — the caller must pass the set
 * of slot indices that were equipped with a retired skill row on this agent.
 * This avoids relying on the skill's slug surviving in the JSON.
 */
// Persist primitive expects merge keys { relicSlug, kind, base64, contentType,
// ext? }. The retired save-asset-relic skill's bodyTemplate read base64 from
// `{{downloadBase64}}` / contentType from `{{downloadContentType}}` because
// cutout / meshy skills emit those names. Rename when converting so persist
// validation doesn't throw "base64: Required".
function remapMergeKeys(inputFrom: unknown): unknown {
  if (!isObject(inputFrom)) return inputFrom;
  if (!isObject(inputFrom.merge)) return inputFrom;
  const renamed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputFrom.merge)) {
    if (k === "downloadBase64") renamed.base64 = v;
    else if (k === "downloadContentType") renamed.contentType = v;
    else renamed[k] = v;
  }
  return { ...inputFrom, merge: renamed };
}

function rewriteNodes(nodes: unknown, slotsToReplace: Set<number>): { changed: boolean; nodes: unknown } {
  if (!Array.isArray(nodes)) return { changed: false, nodes };
  let changed = false;
  const out = nodes.map((raw) => {
    if (!isObject(raw)) return raw;
    if (raw.type === "skill" && typeof raw.slotIndex === "number" && slotsToReplace.has(raw.slotIndex)) {
      changed = true;
      // Replace: keep id / position; drop slotIndex; set type; remap merge keys.
      const next: RawNode = {
        id: raw.id,
        type: "persist",
        inputFrom: remapMergeKeys(raw.inputFrom),
      };
      if (isObject(raw.position)) next.position = raw.position;
      return next;
    }
    // Recurse into loop / forEach body.
    if ((raw.type === "loop" || raw.type === "forEach") && isObject(raw.body)) {
      const body = raw.body;
      const bodyNodes = rewriteNodes(body.nodes, slotsToReplace);
      if (bodyNodes.changed) {
        changed = true;
        return {
          ...raw,
          body: { ...body, nodes: bodyNodes.nodes },
        };
      }
    }
    return raw;
  });
  return { changed, nodes: out };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const tableExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Skill') AS exists`,
    );
    if (!tableExists[0]?.exists) {
      console.log("[migrate-replace-save-asset] Skill table absent — skip");
      return;
    }

    const retiredSkills = await prisma.skill.findMany({
      where: { slug: { in: RETIRED_SKILL_SLUGS } },
      select: { id: true, slug: true },
    });

    if (retiredSkills.length === 0) {
      console.log("[migrate-replace-save-asset] no retired save-asset skills — nothing to do");
      return;
    }

    const retiredIds = new Set(retiredSkills.map((s) => s.id));
    console.log(
      `[migrate-replace-save-asset] found ${retiredSkills.length} retired skill(s): ${retiredSkills
        .map((s) => s.slug)
        .join(", ")}`,
    );

    // For every agent: find slot indices equipped with a retired skill,
    // rewrite its pipelineConfig to replace those skill nodes with persist.
    const agents = await prisma.agent.findMany({
      select: { id: true, codename: true, pipelineConfig: true },
    });

    for (const a of agents) {
      const equips = await prisma.agentSkillEquip.findMany({
        where: { agentId: a.id, skillId: { in: Array.from(retiredIds) } },
        select: { slotIndex: true },
      });
      const slots = new Set<number>();
      for (const e of equips) {
        if (typeof e.slotIndex === "number") slots.add(e.slotIndex);
      }
      if (slots.size === 0 || !isObject(a.pipelineConfig)) continue;

      const cfg = a.pipelineConfig as RawNode;
      if (cfg.version !== 2) continue;
      const rewritten = rewriteNodes(cfg.nodes, slots);
      if (!rewritten.changed) continue;

      await prisma.agent.update({
        where: { id: a.id },
        data: {
          pipelineConfig: { ...cfg, nodes: rewritten.nodes } as never,
        },
      });
      console.log(
        `[migrate-replace-save-asset] rewrote pipelineConfig for ${a.codename}: replaced skill nodes at slot(s) ${[...slots].join(",")} with persist`,
      );
    }

    // Delete equips first (no FK restriction since AgentSkillEquip → Skill
    // is cascade, but explicit count is informative).
    const equipDel = await prisma.agentSkillEquip.deleteMany({
      where: { skillId: { in: Array.from(retiredIds) } },
    });
    if (equipDel.count > 0) {
      console.log(`[migrate-replace-save-asset] deleted ${equipDel.count} retired skill equip row(s)`);
    }

    const skillDel = await prisma.skill.deleteMany({
      where: { slug: { in: RETIRED_SKILL_SLUGS } },
    });
    if (skillDel.count > 0) {
      console.log(`[migrate-replace-save-asset] deleted ${skillDel.count} retired skill row(s)`);
    }

    console.log("[migrate-replace-save-asset] done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate-replace-save-asset] failed:", e);
  process.exit(1);
});
