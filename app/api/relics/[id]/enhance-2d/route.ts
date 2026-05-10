// POST /api/relics/[id]/enhance-2d — admin-only, async via SceneBinding.
//
// Routes through the agent-service's "relic.enhance2d" scene. The actual
// agent (binding-resolved) runs in the background; the runner's
// maybeWriteRelicAsset hook updates Relic.enhancedImagePath on success.
//
// Returns `{ jobId, agentId, status, createdAt }` immediately. Frontend
// polls /api/agent-jobs/[jobId] every 3s.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { recordRelicLog } from "@/lib/relicLog";
import { dispatchScene, SceneError } from "@/lib/agent-service";
import { readRelicImageAsDataUri, ReadImageError } from "@/lib/relics/readImageAsDataUri";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { id } = await params;
  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, slug: true, nameEn: true, primaryImagePath: true, enhancedImagePath: true },
  });
  if (!relic) return NextResponse.json({ error: "relic not found" }, { status: 404 });
  if (!relic.primaryImagePath) {
    return NextResponse.json(
      { error: "relic has no primaryImagePath to enhance" },
      { status: 409 },
    );
  }

  // Pipeline-layer read: pull the image off disk and base64-encode it
  // here so the agent DAG never has to. Replaces the slot-0 image-to-
  // data-uri INTERNAL skill that used to live inside CUTOUT-FORGE-001.
  let imageDataUri: string;
  try {
    const enc = await readRelicImageAsDataUri(relic.primaryImagePath);
    imageDataUri = enc.dataUri;
  } catch (e) {
    if (e instanceof ReadImageError) {
      const status = e.code === "NOT_FOUND" ? 404 : e.code === "TOO_LARGE" ? 413 : 400;
      return NextResponse.json({ error: `image read failed: ${e.message}` }, { status });
    }
    console.error("[api/relics/enhance-2d] image read threw", e);
    return NextResponse.json({ error: "image read failed" }, { status: 500 });
  }

  let dispatch;
  try {
    dispatch = await dispatchScene(
      "relic.enhance2d",
      {
        relicId: relic.id,
        relicSlug: relic.slug,
        imageDataUri,
      },
      { actor: { userId: me.id, level: me.level, name: me.name } },
    );
  } catch (e) {
    if (e instanceof SceneError) {
      return NextResponse.json({ error: e.message }, { status: e.httpStatus });
    }
    console.error("[api/relics/enhance-2d] dispatch failed", e);
    return NextResponse.json({ error: "enqueue failed" }, { status: 500 });
  }

  await recordRelicLog({
    action: "PROCESSING_STARTED",
    relic: { id: relic.id, slug: relic.slug, name: relic.nameEn || relic.slug },
    actor: { id: me.id, name: me.name },
    details: { phase: "enhance2d", jobId: dispatch.jobId },
  });

  return NextResponse.json(
    {
      jobId: dispatch.jobId,
      agentId: dispatch.agentId,
      status: dispatch.status,
      createdAt: dispatch.createdAt,
    },
    { status: 201 },
  );
}
