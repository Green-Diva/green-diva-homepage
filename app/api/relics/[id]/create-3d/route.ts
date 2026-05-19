// POST /api/relics/[id]/create-3d — admin-only, async via SceneBinding.
//
// Routes through the agent-service's "relic.create3d" scene. Hard
// precondition: Relic.enhancedImages must contain ≥1 entry (i.e. 2D 增强
// has already run). Meshy gets transparent PNGs, not the original snapshot,
// so 3D quality stays high. 409 if precondition fails.
//
// 2026-05-20 multi-image: body can include `items: [{enhancedPath}, ...]`
// (1-4). All listed paths must already exist in Relic.enhancedImages. The
// endpoint loads each as a data URI and hands the array to Meshy's
// /multi-image-to-3d for multi-view fusion. When `items` is missing,
// falls back to the first enhanced image (single-view, back-compat with
// older clients).
//
// Returns `{ jobId, agentId, status, createdAt }`; frontend polls
// /api/agent-jobs/[jobId]. Runner's writeback hook fills Relic.modelPath
// on success.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { recordRelicLog } from "@/lib/relicLog";
import { dispatchScene, SceneError } from "@/lib/agent-service";
import { readRelicImageAsDataUri, ReadImageError } from "@/lib/relics/readImageAsDataUri";

// Body schema for the pre-flight 3D config dialog. All Meshy fields
// optional — missing keys fall back to the meshy3d handler's defaults
// (PBR / HD / auto-size all on, GLB only, auto symmetry, standard
// model_type).
//
// `items: [{enhancedPath}, ...]` (1-4) selects which enhanced images
// feed multi-view fusion. When omitted, the first enhanced image is
// used (single-view back-compat).
const Body = z
  .object({
    enablePbr: z.boolean().optional(),
    hdTexture: z.boolean().optional(),
    autoSize: z.boolean().optional(),
    targetFormats: z.array(z.enum(["glb", "obj", "fbx", "stl", "usdz", "3mf"])).optional(),
    texturePrompt: z.string().max(600).optional(),
    targetPolycount: z.number().int().min(100).max(300_000).optional(),
    symmetryMode: z.enum(["off", "auto", "on"]).optional(),
    modelType: z.enum(["standard", "lowpoly"]).optional(),
    items: z
      .array(z.object({ enhancedPath: z.string().min(1) }).strict())
      .min(1)
      .max(4)
      .optional(),
  })
  .strict();

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  // Parse optional Meshy-config body. Older clients still POST with empty body
  // — keep backward compat by treating missing/invalid JSON as no overrides.
  let opts: z.infer<typeof Body> = {};
  try {
    const raw = await req.json();
    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid options: " + parsed.error.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    }
    opts = parsed.data;
  } catch {
    // empty / non-JSON body → use defaults
  }

  const { id } = await params;
  const relic = await prisma.relic.findUnique({
    where: { id },
    select: { id: true, slug: true, nameEn: true, enhancedImages: true, modelPath: true },
  });
  if (!relic) return NextResponse.json({ error: "relic not found" }, { status: 404 });
  const enhancedList: Array<{ path?: string }> = Array.isArray(relic.enhancedImages)
    ? (relic.enhancedImages as Array<{ path?: string }>)
    : [];
  if (enhancedList.length === 0) {
    return NextResponse.json(
      { error: "需要先完成 2D 增强 (Relic.enhancedImages is empty)" },
      { status: 409 },
    );
  }

  // Resolve the 1-4 enhanced paths to feed Meshy multi-view fusion.
  // items[] from the body picks specific enhance sources; without it
  // we fall back to the first enhanced entry (single-view).
  const allowedPaths = new Set(
    enhancedList.map((e) => e.path).filter((p): p is string => typeof p === "string"),
  );
  let selectedPaths: string[];
  if (opts.items && opts.items.length > 0) {
    const requested = opts.items.map((it) => it.enhancedPath);
    const unknown = requested.filter((p) => !allowedPaths.has(p));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `items[] contains paths not in Relic.enhancedImages: ${unknown.join(", ")}` },
        { status: 400 },
      );
    }
    // Dedupe while preserving caller order — admin picked them in this order.
    selectedPaths = Array.from(new Set(requested));
  } else {
    const first = enhancedList[0]?.path;
    if (!first) {
      return NextResponse.json(
        { error: "enhancedImages[0] has no path" },
        { status: 409 },
      );
    }
    selectedPaths = [first];
  }

  // Pipeline-layer read: base64-encode every selected enhance image here
  // so the agent DAG never has to. Read serially; up to 4 images keeps
  // the total well under fal/Meshy body limits.
  const imageDataUris: string[] = [];
  for (const p of selectedPaths) {
    try {
      const enc = await readRelicImageAsDataUri(p);
      imageDataUris.push(enc.dataUri);
    } catch (e) {
      if (e instanceof ReadImageError) {
        const status = e.code === "NOT_FOUND" ? 404 : e.code === "TOO_LARGE" ? 413 : 400;
        return NextResponse.json(
          { error: `image read failed (${p}): ${e.message}` },
          { status },
        );
      }
      console.error("[api/relics/create-3d] image read threw", e);
      return NextResponse.json({ error: "image read failed" }, { status: 500 });
    }
  }

  // Don't forward items[] into the scene ctx — the scene's contextSchema
  // doesn't know about it. items resolved → imageDataUris above.
  const { items: _ignored, ...meshyOpts } = opts;
  void _ignored;

  let dispatch;
  try {
    dispatch = await dispatchScene(
      "relic.create3d",
      {
        relicId: relic.id,
        relicSlug: relic.slug,
        imageDataUris,
        opts: meshyOpts,
      },
      { actor: { userId: me.id, level: me.level, name: me.name } },
    );
  } catch (e) {
    if (e instanceof SceneError) {
      return NextResponse.json({ error: e.message }, { status: e.httpStatus });
    }
    console.error("[api/relics/create-3d] dispatch failed", e);
    return NextResponse.json({ error: "enqueue failed" }, { status: 500 });
  }

  await recordRelicLog({
    action: "PROCESSING_STARTED",
    relic: { id: relic.id, slug: relic.slug, name: relic.nameEn || relic.slug },
    actor: { id: me.id, name: me.name },
    details: { phase: "3d", jobId: dispatch.jobId },
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
