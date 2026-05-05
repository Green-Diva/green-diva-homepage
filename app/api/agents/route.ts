import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { agentCreateSchema } from "@/lib/validators";
import { AuthError, requireAdmin, requireUser } from "@/lib/auth";

export async function GET() {
  try {
    await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const agents = await prisma.agent.findMany({
    orderBy: [{ serial: "asc" }, { createdAt: "asc" }],
    include: {
      createdBy: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json(agents);
}

export async function POST(req: NextRequest) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const json = await req.json().catch(() => null);
  const parsed = agentCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const max = await tx.agent.aggregate({ _max: { serial: true } });
      const nextSerial = (max._max.serial ?? 0) + 1;
      return tx.agent.create({
        data: {
          serial: nextSerial,
          codename: data.codename,
          nameEn: data.nameEn,
          nameZh: data.nameZh,
          classification: data.classification ?? null,
          mode: data.mode ?? "MECHANICAL",
          status: data.status ?? "STANDBY",
          avatarUrl: data.avatarUrl,
          descriptionEn: data.descriptionEn ?? null,
          descriptionZh: data.descriptionZh ?? null,
          syncLevel: data.syncLevel ?? 0,
          matrixLevel: data.matrixLevel ?? 1,
          chaosLevel: data.chaosLevel ?? 0,
          costTier: data.costTier ?? 0,
          activityLevel: data.activityLevel ?? 0,
          stabilityLevel: data.stabilityLevel ?? 0,
          pipelineConfig:
            data.pipelineConfig == null
              ? Prisma.JsonNull
              : (data.pipelineConfig as Prisma.InputJsonValue),
          dispatcherConfig:
            data.dispatcherConfig == null
              ? Prisma.JsonNull
              : (data.dispatcherConfig as Prisma.InputJsonValue),
          skills: (data.skills ?? undefined) as Prisma.InputJsonValue | undefined,
          availableAp: data.availableAp ?? 0,
          enabled: data.enabled ?? true,
          provider: data.provider ?? "ECHO",
          model: data.model ?? null,
          systemPrompt: data.systemPrompt ?? null,
          internalHandler: data.internalHandler ?? null,
          inputSchemaJson: data.inputSchemaJson ?? null,
          outputSchemaJson: data.outputSchemaJson ?? null,
          maxTokens: data.maxTokens ?? null,
          temperature: data.temperature ?? null,
          rateLimitPerMin: data.rateLimitPerMin ?? null,
          createdById: me.id,
        },
      });
    });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    console.error("[api/agents POST] create failed", e);
    return NextResponse.json({ error: "create failed" }, { status: 400 });
  }
}
