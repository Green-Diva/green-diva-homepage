import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { agentCreateSchema } from "@/lib/validators";
import { AuthError, requireAdmin, requireUser } from "@/lib/auth";
import { respondError, respondAuthError, respondValidationError } from "@/lib/api-error";

export async function GET() {
  try {
    await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
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
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }

  const json = await req.json().catch(() => null);
  const parsed = agentCreateSchema.safeParse(json);
  if (!parsed.success) {
    return respondValidationError(parsed.error.flatten());
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
          codenameZh: data.codenameZh ?? null,
          nameEn: data.nameEn,
          nameZh: data.nameZh,
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
          createdById: me.id,
        },
      });
    });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    console.error("[api/agents POST] create failed", e);
    return respondError("CREATE_FAILED", "create failed", 400);
  }
}
