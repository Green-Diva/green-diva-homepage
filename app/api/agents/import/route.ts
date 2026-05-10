// POST /api/agents/import — admin-only.
//
// Consumes a payload produced by /api/agents/[id]/export and re-creates
// the agent + every equipped skill on this deployment. Conflicts:
//   - Codename collision: returns 409 with a `conflict: "codename"` flag
//     unless `newCodename` is supplied OR `rejectOnAgentConflict: false`.
//   - Skill slug collision:
//       skillConflict="reuse" (default) → keep existing skill row, equip
//         the new agent against it. (Admin can compare configs via
//         SkillLibrary later if they doubt the match.)
//       skillConflict="rename" → suffix the imported skill's slug
//         (`-imp-<n>`) and create a fresh skill row with the imported
//         handlerConfig.
//
// The agent is created with `deployedAt = null` so admin tests it via
// /agent-control before flipping deploy.

import { NextRequest, NextResponse } from "next/server";
import { Prisma, type PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { agentImportOptionsSchema, type AgentExport } from "@/lib/validators";

type ImportSkill = AgentExport["skills"][number];

function jsonOrNull(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return v === undefined || v === null ? Prisma.JsonNull : (v as Prisma.InputJsonValue);
}

function genCuid(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(12).toString("hex").slice(0, 21 - ts.length);
  return `c${ts}${rand}`.padEnd(25, "0").slice(0, 25);
}

// Find a slug that doesn't collide with existing skills. Used when
// admin chose skillConflict="rename" — appends "-imp-<n>" until a free
// slot is found. Bounded to 64 chars (matches DB column).
async function pickFreshSlug(
  tx: Pick<PrismaClient, "skill">,
  base: string,
): Promise<string> {
  const root = base.length > 56 ? base.slice(0, 56) : base;
  for (let n = 1; n < 100; n++) {
    const candidate = `${root}-imp-${n}`.slice(0, 64);
    const taken = await tx.skill.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  // Pathological — fall back to random tail.
  return `${root}-imp-${randomBytes(4).toString("hex")}`.slice(0, 64);
}

async function resolveSkillEquip(
  tx: Pick<PrismaClient, "skill">,
  s: ImportSkill,
  policy: "reuse" | "rename",
  createdById: string | null,
): Promise<{ skillId: string; reused: boolean }> {
  const existing = await tx.skill.findUnique({ where: { slug: s.slug } });
  if (existing) {
    if (policy === "reuse") {
      return { skillId: existing.id, reused: true };
    }
    // rename: create a parallel row with a unique suffix slug.
    const slug = await pickFreshSlug(tx, s.slug);
    const created = await tx.skill.create({
      data: {
        slug,
        level: s.level,
        icon: s.icon,
        nameEn: s.nameEn,
        nameZh: s.nameZh,
        kind: s.kind,
        costAp: s.costAp,
        descriptionEn: s.descriptionEn,
        descriptionZh: s.descriptionZh,
        status: s.status,
        handlerKind: s.handlerKind,
        handlerConfig: jsonOrNull(s.handlerConfig),
        inputSchema: jsonOrNull(s.inputSchema),
        outputSchema: jsonOrNull(s.outputSchema),
        createdById,
      },
      select: { id: true },
    });
    return { skillId: created.id, reused: false };
  }
  // No collision — straight create with the original slug.
  const created = await tx.skill.create({
    data: {
      slug: s.slug,
      level: s.level,
      icon: s.icon,
      nameEn: s.nameEn,
      nameZh: s.nameZh,
      kind: s.kind,
      costAp: s.costAp,
      descriptionEn: s.descriptionEn,
      descriptionZh: s.descriptionZh,
      status: s.status,
      handlerKind: s.handlerKind,
      handlerConfig: jsonOrNull(s.handlerConfig),
      inputSchema: jsonOrNull(s.inputSchema),
      outputSchema: jsonOrNull(s.outputSchema),
      createdById,
    },
    select: { id: true },
  });
  return { skillId: created.id, reused: false };
}

export async function POST(req: NextRequest) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = agentImportOptionsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "invalid import payload: " +
          parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; "),
      },
      { status: 400 },
    );
  }
  const { payload, newCodename, rejectOnAgentConflict, skillConflict } = parsed.data;

  // Codename collision check up-front (outside the transaction so we can
  // surface a 409 with a clean message).
  const targetCodename = newCodename ?? payload.agent.codename;
  const existingAgent = await prisma.agent.findUnique({
    where: { codename: targetCodename },
    select: { id: true, codename: true },
  });
  if (existingAgent && rejectOnAgentConflict !== false) {
    return NextResponse.json(
      {
        error: `agent codename "${targetCodename}" already exists`,
        conflict: "codename",
        existingId: existingAgent.id,
      },
      { status: 409 },
    );
  }

  // All-or-nothing: skill rows + agent row + equips in one transaction.
  // If any single step fails (e.g. unique-slug race), nothing persists.
  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Resolve every imported skill (reuse / rename / fresh-create).
      const resolved: Array<{
        slot: number | null;
        unlocked: boolean;
        skillId: string;
        reused: boolean;
        sourceSlug: string;
      }> = [];
      for (const s of payload.skills) {
        const { skillId, reused } = await resolveSkillEquip(
          tx,
          s,
          skillConflict ?? "reuse",
          me.id,
        );
        resolved.push({
          slot: s.slotIndex,
          unlocked: s.unlocked,
          skillId,
          reused,
          sourceSlug: s.slug,
        });
      }

      // 2. Create the agent. deployedAt is null on import — admin tests
      // first, then deploys via /agent-control.
      const agentId = genCuid();
      const agentRow = await tx.agent.create({
        data: {
          id: agentId,
          codename: targetCodename,
          codenameZh: payload.agent.codenameZh ?? null,
          nameEn: payload.agent.nameEn,
          nameZh: payload.agent.nameZh,
          mode: payload.agent.mode,
          status: "STANDBY",
          avatarUrl: payload.agent.avatarUrl,
          descriptionEn: payload.agent.descriptionEn ?? null,
          descriptionZh: payload.agent.descriptionZh ?? null,
          capabilities: payload.agent.capabilities ?? [],
          pipelineConfig: jsonOrNull(payload.agent.pipelineConfig),
          dispatcherConfig: jsonOrNull(payload.agent.dispatcherConfig),
          createdById: me.id,
        },
        select: { id: true, codename: true },
      });

      // 3. Equip — atomic createMany; @@unique(agentId, skillId) guards
      // against accidental duplicates within the import payload.
      if (resolved.length > 0) {
        await tx.agentSkillEquip.createMany({
          data: resolved.map((r) => ({
            agentId: agentRow.id,
            skillId: r.skillId,
            slotIndex: r.slot,
            unlocked: r.unlocked,
          })),
        });
      }

      return {
        agentId: agentRow.id,
        codename: agentRow.codename,
        skills: resolved.map((r) => ({
          sourceSlug: r.sourceSlug,
          skillId: r.skillId,
          reused: r.reused,
        })),
      };
    });

    return NextResponse.json(
      {
        agentId: result.agentId,
        codename: result.codename,
        skillsResolved: result.skills,
      },
      { status: 201 },
    );
  } catch (e) {
    console.error("[api/agents/import] failed", e);
    const message = e instanceof Error ? e.message : "import failed";
    return NextResponse.json({ error: `import failed: ${message.slice(0, 300)}` }, { status: 500 });
  }
}
