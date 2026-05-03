import { NextRequest, NextResponse } from "next/server";
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
          status: data.status ?? "STANDBY",
          avatarUrl: data.avatarUrl ?? null,
          descriptionEn: data.descriptionEn ?? null,
          descriptionZh: data.descriptionZh ?? null,
          syncLevel: data.syncLevel ?? 0,
          matrixLevel: data.matrixLevel ?? 1,
          quickness: data.quickness ?? 50,
          intelligence: data.intelligence ?? 50,
          neuralLink: data.neuralLink ?? 50,
          bioSync: data.bioSync ?? 50,
          logic: data.logic ?? 50,
          compassion: data.compassion ?? 50,
          skills: data.skills ?? undefined,
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
