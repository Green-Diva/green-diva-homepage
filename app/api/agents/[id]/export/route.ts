// GET /api/agents/[id]/export — admin-only.
//
// Returns a self-contained JSON describing the agent + its full backbone +
// every equipped skill (definition + slot). The import endpoint
// (/api/agents/import) consumes this exact shape.
//
// Excluded by design:
//   - runtime state (deployedAt, createdAt, updatedAt, AgentJob history)
//   - DB ids (rebuilt on import)
//   - createdById (the importer becomes the owner)
//   - SceneBindings (deployment-specific; admin rebinds after import)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import type { AgentExport } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { id } = await params;

  const agent = await prisma.agent.findUnique({
    where: { id },
    include: {
      skillEquips: {
        include: { skill: true },
        orderBy: [{ slotIndex: "asc" }],
      },
    },
  });
  if (!agent) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }

  const payload: AgentExport = {
    format: "green-diva-agent-export-v1",
    exportedAt: new Date().toISOString(),
    exportedBy: me.name,
    agent: {
      codename: agent.codename,
      codenameZh: agent.codenameZh,
      nameEn: agent.nameEn,
      nameZh: agent.nameZh,
      mode: agent.mode,
      avatarUrl: agent.avatarUrl,
      descriptionEn: agent.descriptionEn,
      descriptionZh: agent.descriptionZh,
      capabilities: agent.capabilities,
      pipelineConfig: agent.pipelineConfig,
      dispatcherConfig: agent.dispatcherConfig,
    },
    skills: agent.skillEquips
      .filter((e) => !!e.skill)
      .map((e) => ({
        slug: e.skill.slug ?? deriveTransientSlug(e.skill.nameEn, e.skillId),
        level: e.skill.level,
        icon: e.skill.icon,
        nameEn: e.skill.nameEn,
        nameZh: e.skill.nameZh,
        kind: e.skill.kind,
        costAp: e.skill.costAp,
        descriptionEn: e.skill.descriptionEn,
        descriptionZh: e.skill.descriptionZh,
        status: e.skill.status,
        handlerKind: e.skill.handlerKind,
        handlerConfig: (e.skill.handlerConfig ?? {}) as Record<string, unknown>,
        inputSchema: (e.skill.inputSchema ?? null) as Record<string, unknown> | null,
        outputSchema: (e.skill.outputSchema ?? null) as Record<string, unknown> | null,
        slotIndex: e.slotIndex,
        unlocked: e.unlocked,
      })),
  };

  // Browsers will default to viewing JSON inline; suggest a filename so
  // admins who hit the URL via "Save as" land on something readable.
  const filename = `${agent.codename.toLowerCase()}-export.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

// Older Skill rows may have NULL slug (pre-migrate-skill-slug). For
// export we synthesise a stable kebab-cased fallback so import has
// something to key on.
function deriveTransientSlug(nameEn: string, id: string): string {
  const base = nameEn
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const tail = id.slice(-8);
  return `${base || "skill"}-${tail}`;
}
