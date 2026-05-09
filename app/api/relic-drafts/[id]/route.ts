// Per-draft operations:
//   GET    — admin polls/pulls draft state + generatedMetadata.
//   PATCH  — admin edits the AI-generated metadata before confirming.
//            Only allowed once the draft has reached READY_TO_REVIEW.
//   DELETE — admin abandons the draft. Deletes the workspace dir + DB row,
//            releasing the slot.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { resolveRelicAsset } from "@/lib/relicStorage";
import { ensureServerInit } from "@/lib/server-init";

const RARITY_VALUES = ["COMMON", "RARE", "EPIC", "LEGENDARY", "SPECIAL"] as const;
const FORM_KIND_VALUES = ["TWO_D", "THREE_D"] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
  await ensureServerInit();

  const { id } = await params;
  const draft = await prisma.relicDraft.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ draft });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const draft = await prisma.relicDraft.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Block edits while the pipeline is mid-run — the agent will overwrite us.
  if (draft.status !== "READY_TO_REVIEW" && draft.status !== "FAILED") {
    return NextResponse.json(
      { error: `draft not editable (status=${draft.status})` },
      { status: 409 },
    );
  }

  const bodyRaw = (await req.json().catch(() => null)) as unknown;
  if (!isObject(bodyRaw)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const body: Record<string, unknown> = bodyRaw;

  // Merge into existing generatedMetadata; only known fields are accepted.
  const existing = isObject(draft.generatedMetadata) ? draft.generatedMetadata : {};
  const next: Record<string, unknown> = { ...existing };

  function setStr(key: string, max: number) {
    if (key in body) {
      const v = body[key];
      if (v === null) next[key] = null;
      else if (typeof v === "string") next[key] = v.slice(0, max);
    }
  }
  setStr("iconKey", 64);
  setStr("nameZh", 48);
  setStr("nameEn", 80);
  setStr("classifZh", 64);
  setStr("classifEn", 80);
  setStr("formReason", 500);
  setStr("loreZh", 4000);
  setStr("loreEn", 4000);
  setStr("primaryImagePath", 500);

  if ("rarity" in body) {
    const v = body.rarity;
    if (typeof v === "string" && (RARITY_VALUES as readonly string[]).includes(v)) {
      next.rarity = v;
    }
  }
  if ("formKind" in body) {
    const v = body.formKind;
    if (v === null) next.formKind = null;
    else if (typeof v === "string" && (FORM_KIND_VALUES as readonly string[]).includes(v)) {
      next.formKind = v;
    }
  }
  if ("candidateImages" in body) {
    const v = body.candidateImages;
    if (v === null) next.candidateImages = null;
    else if (Array.isArray(v)) {
      // Trust the shape — admin-only endpoint, schema guarded by RelicForm.
      next.candidateImages = v;
    }
  }

  try {
    const updated = await prisma.relicDraft.update({
      where: { id },
      data: {
        generatedMetadata: next as unknown as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ draft: updated });
  } catch (e) {
    console.error("[api/relic-drafts/PATCH] update failed", e);
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const draft = await prisma.relicDraft.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ ok: true }); // idempotent

  // Mark CANCELLED first so any in-flight runner sees it on its next poll
  // and bails out gracefully instead of writing back into the row mid-delete.
  try {
    await prisma.relicDraft.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
  } catch {}

  // Best-effort fs cleanup. Workspace dir was set during upload; if the
  // draft never finished its initial write phase the path may still be
  // relative to the same convention.
  const workspacePath = draft.workspaceDir ?? `/_drafts/${id}`;
  const abs = resolveRelicAsset(workspacePath);
  if (abs) {
    try {
      await fs.rm(abs, { recursive: true, force: true });
    } catch (e) {
      console.warn("[api/relic-drafts/DELETE] fs cleanup failed", e);
    }
  }

  try {
    await prisma.relicDraft.delete({ where: { id } });
  } catch (e) {
    console.warn("[api/relic-drafts/DELETE] db delete failed (already gone?)", e);
  }
  return NextResponse.json({ ok: true });
}
