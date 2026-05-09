// Confirm a RelicDraft into a real Relic. The pivotal step in the new flow:
//
//   1. fs.rename _drafts/<draftId>/ → <newSlug>/  (no rollback if this fails)
//   2. transaction: create Relic row (slot transferred from draft) +
//      RelicProcessingJob (PACK_DERIVED) + delete RelicDraft
//   3. fire-and-forget runFinalizePipeline(jobId) → packs derived archive,
//      flips Relic.status to READY (or PARTIAL on pack failure).
//
// We do the fs rename BEFORE the transaction because:
//   - Renames are atomic on the same filesystem; failure modes are clean.
//   - If we transact first then rename, a rename failure leaves a Relic row
//     pointing at non-existent files. Doing it the other way means a
//     transaction failure leaves us with renamed files but no Relic — we
//     attempt a rename-back compensation, and if even that fails the disk
//     state is recoverable by the next confirm attempt.
//
// Path rewrites: all generatedMetadata paths use the workspace prefix
// "/_drafts/<draftId>/...". On confirm we rewrite every "_drafts/<id>" →
// "<newSlug>" before storing on the Relic row.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { RELIC_STORAGE_ROOT } from "@/lib/relicStorage";
import { recordRelicLog } from "@/lib/relicLog";
import { runFinalizePipeline } from "@/lib/relics/pipeline/finalize/runner";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function rewritePathPrefix(p: unknown, draftId: string, newSlug: string): unknown {
  if (typeof p !== "string") return p;
  return p.replace(`/_drafts/${draftId}`, `/${newSlug}`);
}

function rewriteCandidates(raw: unknown, draftId: string, newSlug: string): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((c) => {
    if (!isObject(c)) return c;
    if (typeof c.path === "string") {
      return { ...c, path: rewritePathPrefix(c.path, draftId, newSlug) };
    }
    return c;
  });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id: draftId } = await params;
  const draft = await prisma.relicDraft.findUnique({ where: { id: draftId } });
  if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (draft.status !== "READY_TO_REVIEW") {
    return NextResponse.json(
      { error: `draft not ready (status=${draft.status})` },
      { status: 409 },
    );
  }

  const meta = isObject(draft.generatedMetadata) ? draft.generatedMetadata : null;
  if (!meta) {
    return NextResponse.json({ error: "generated metadata missing" }, { status: 409 });
  }
  // Required text fields — without these we'd fail Relic insert anyway.
  for (const k of ["nameEn", "nameZh", "classifEn", "classifZh", "rarity"]) {
    if (typeof meta[k] !== "string" || !(meta[k] as string).trim()) {
      return NextResponse.json({ error: `metadata missing ${k}` }, { status: 409 });
    }
  }

  // Allocate the new slug. crypto.randomBytes is fine here — collisions on
  // the @unique slug field would surface as a P2002 in the transaction.
  const slot = draft.slot;
  const slugSuffix = crypto.randomBytes(4).toString("hex").slice(0, 6);
  const newSlug = `vault-${String(slot).padStart(3, "0")}-${slugSuffix}`;
  const oldDirAbs = path.join(RELIC_STORAGE_ROOT, "_drafts", draftId);
  const newDirAbs = path.join(RELIC_STORAGE_ROOT, newSlug);

  // Verify workspace exists. If not, the draft was created but the upload
  // write phase never completed — admin should cancel + retry.
  try {
    await fs.stat(oldDirAbs);
  } catch {
    return NextResponse.json(
      { error: "workspace dir missing — cannot confirm; please cancel and re-upload" },
      { status: 409 },
    );
  }

  // 1. Rename workspace into the final slug location.
  try {
    await fs.rename(oldDirAbs, newDirAbs);
  } catch (e) {
    console.error("[api/relic-drafts/confirm] rename failed", e);
    return NextResponse.json({ error: "filesystem rename failed" }, { status: 500 });
  }

  // 2. Rewrite path prefixes inside the metadata payload (candidates'
  //    path field, primaryImagePath) and the draft's archivePath.
  const newPrimary = rewritePathPrefix(meta.primaryImagePath, draftId, newSlug) as
    | string
    | null
    | undefined;
  const newCandidates = rewriteCandidates(meta.candidateImages, draftId, newSlug) as unknown;
  const newArchivePath =
    typeof draft.archivePath === "string"
      ? rewritePathPrefix(draft.archivePath, draftId, newSlug)
      : null;

  // 3. Transaction: create Relic + create finalize job + delete draft.
  let created: { relicId: string; jobId: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const relic = await tx.relic.create({
        data: {
          slot,
          slug: newSlug,
          nameEn: String(meta.nameEn),
          nameZh: String(meta.nameZh),
          classifEn: String(meta.classifEn),
          classifZh: String(meta.classifZh),
          rarity: meta.rarity as
            | "COMMON" | "RARE" | "EPIC" | "LEGENDARY" | "SPECIAL",
          iconKey: typeof meta.iconKey === "string" ? meta.iconKey : null,
          loreEn: typeof meta.loreEn === "string" ? meta.loreEn : null,
          loreZh: typeof meta.loreZh === "string" ? meta.loreZh : null,
          formKind:
            meta.formKind === "TWO_D" || meta.formKind === "THREE_D"
              ? meta.formKind
              : null,
          formReason: typeof meta.formReason === "string" ? meta.formReason : null,
          primaryImagePath: typeof newPrimary === "string" ? newPrimary : null,
          candidateImages:
            newCandidates === null || newCandidates === undefined
              ? Prisma.JsonNull
              : (newCandidates as Prisma.InputJsonValue),
          pipelineTrace:
            draft.pipelineTrace === null || draft.pipelineTrace === undefined
              ? Prisma.JsonNull
              : (draft.pipelineTrace as Prisma.InputJsonValue),
          archivePath: typeof newArchivePath === "string" ? newArchivePath : null,
          draftNote: draft.draftNote,
          status: "PROCESSING",
        },
        select: { id: true, slug: true, nameEn: true },
      });
      const job = await tx.relicProcessingJob.create({
        data: {
          relicId: relic.id,
          status: "PENDING",
          step: "PACK_DERIVED",
          progress: 0,
        },
        select: { id: true },
      });
      await tx.relicDraft.delete({ where: { id: draftId } });
      return { relicId: relic.id, jobId: job.id };
    });
  } catch (e) {
    console.error("[api/relic-drafts/confirm] transaction failed", e);
    // Compensate: rename back to the workspace location.
    try {
      await fs.rename(newDirAbs, oldDirAbs);
    } catch (e2) {
      console.error("[api/relic-drafts/confirm] rename-back compensation failed", e2);
    }
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }

  await recordRelicLog({
    action: "CREATED",
    relic: { id: created.relicId, slug: newSlug, name: String(meta.nameEn) },
    actor: { id: me.id, name: me.name },
    details: { slot, fromDraftId: draftId },
  });
  await recordRelicLog({
    action: "PROCESSING_STARTED",
    relic: { id: created.relicId, slug: newSlug, name: String(meta.nameEn) },
    actor: { id: me.id, name: me.name },
    details: { phase: "finalize", jobId: created.jobId },
  });

  void runFinalizePipeline(created.jobId).catch((e) => {
    console.error("[api/relic-drafts/confirm] finalize kickoff threw", { jobId: created.jobId, e });
  });

  return NextResponse.json({ relicId: created.relicId, slug: newSlug });
}
