"use client";

// Three-stage upload→preview→confirm modal.
//
//   Stage 1 "upload":   admin picks files + writes a description, hits POST
//                        /api/relic-drafts. We DON'T navigate away on success
//                        — the same modal stays mounted and switches to:
//   Stage 2 "waiting":   3-second polling of GET /api/relic-drafts/[id].
//                        When status flips to READY_TO_REVIEW we transition to
//                        stage 3; on FAILED we render a retry/abandon prompt.
//   Stage 3 "preview":   DraftPreviewBody renders editable AI output. Three
//                        actions: 保存并存入 (PATCH then confirm), 直接存入
//                        (confirm without edits), 放弃 (DELETE the draft).
//
// On confirm: server creates a real Relic, returns its slug, we router.push
// to the detail page. On abandon: DELETE clears the draft, we refresh the
// vault grid and close.
//
// Recovery: passing existingDraftId on mount skips stage 1 entirely. The
// vault grid does this when admin clicks an in-progress draft cell.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import DraftPreviewBody, { type DraftMetadata } from "./DraftPreviewBody";

const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_PER_FILE_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 8;
const ACCEPT_ATTR = "image/*";
// Polling cadence while waiting for the agent. The server now writes
// progress at ~5 distinct points (extract start/done, summary, research,
// pick), so a faster poll keeps the bar lively without thrashing the DB.
const POLL_MS = 1500;

type DraftRecord = {
  id: string;
  slot: number;
  status: "PENDING" | "RUNNING" | "READY_TO_REVIEW" | "FAILED" | "CANCELLED";
  step: string;
  progress: number;
  errorMessage: string | null;
  generatedMetadata: DraftMetadata | null;
};

// Stage timeline shown during the waiting view. Mirrors the progress
// thresholds set by lib/relics/pipeline/draft/runner.ts — keep them in sync.
// `doneAt` = the percentage at which this stage has finished; the next
// stage's running window starts where the previous one ends.
type StageId = "extract" | "summary" | "research" | "pick";
type StageStatus = "pending" | "running" | "done" | "failed";

const STAGE_DEFS: { id: StageId; doneAt: number }[] = [
  { id: "extract", doneAt: 50 },
  { id: "summary", doneAt: 62 },
  { id: "research", doneAt: 92 },
  { id: "pick", doneAt: 98 },
];

function computeStages(
  draft: DraftRecord | null,
  stage: Stage,
): { id: StageId; status: StageStatus }[] {
  const progress = draft?.progress ?? 0;
  const failed = stage === "failed" || draft?.status === "FAILED";
  let activeIdx = STAGE_DEFS.findIndex((s) => progress < s.doneAt);
  if (activeIdx < 0) activeIdx = STAGE_DEFS.length;
  return STAGE_DEFS.map((s, i) => {
    if (i < activeIdx) return { id: s.id, status: "done" as StageStatus };
    if (i === activeIdx) {
      return { id: s.id, status: (failed ? "failed" : "running") as StageStatus };
    }
    return { id: s.id, status: "pending" as StageStatus };
  });
}

type Stage = "upload" | "waiting" | "preview" | "failed";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

type Props = {
  slot: number;
  existingDraftId?: string;
  onClose: () => void;
};

export default function RelicDraftPanel({ slot, existingDraftId, onClose }: Props) {
  const t = useT();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>(existingDraftId ? "waiting" : "upload");
  const [draftId, setDraftId] = useState<string | null>(existingDraftId ?? null);
  const [draft, setDraft] = useState<DraftRecord | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState(false); // for stage 3 actions (confirm / abandon)
  const [error, setError] = useState<string | null>(null);

  const totalBytes = files.reduce((s, f) => s + f.size, 0);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, submitting, busy]);

  // Stage 2 polling: while a draftId is set and stage is "waiting", poll
  // every POLL_MS until status leaves PENDING/RUNNING.
  useEffect(() => {
    if (!draftId) return;
    if (stage !== "waiting") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const r = await fetch(`/api/relic-drafts/${draftId}`, { credentials: "include" });
        if (!r.ok) {
          // Treat 404 as "draft was deleted out from under us" — close modal.
          if (r.status === 404) {
            if (!cancelled) onClose();
            return;
          }
          throw new Error(`status ${r.status}`);
        }
        const j = (await r.json()) as { draft: DraftRecord };
        if (cancelled) return;
        setDraft(j.draft);
        if (j.draft.status === "READY_TO_REVIEW") {
          setStage("preview");
        } else if (j.draft.status === "FAILED") {
          setStage("failed");
        } else if (j.draft.status === "CANCELLED") {
          onClose();
        } else {
          timer = setTimeout(tick, POLL_MS);
        }
      } catch (e) {
        console.warn("[RelicDraftPanel] poll failed", e);
        timer = setTimeout(tick, POLL_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [draftId, stage, onClose]);

  async function submitUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (files.length === 0) {
      setError(t.relicCollection.draftPanelMissingFile);
      return;
    }
    if (
      files.length > MAX_FILES ||
      totalBytes > MAX_TOTAL_BYTES ||
      files.some((f) => f.size > MAX_PER_FILE_BYTES)
    ) {
      setError(t.relicCollection.draftPanelSubmitFailed);
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("slot", String(slot));
      fd.append("description", description);
      for (const f of files) fd.append("files", f, f.name);
      const r = await fetch("/api/relic-drafts", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error || t.relicCollection.draftPanelSubmitFailed);
        setSubmitting(false);
        return;
      }
      const json = (await r.json()) as { draftId: string };
      setDraftId(json.draftId);
      setStage("waiting");
      setSubmitting(false);
    } catch (err) {
      console.error("[RelicDraftPanel] upload failed", err);
      setError(t.relicCollection.draftPanelSubmitFailed);
      setSubmitting(false);
    }
  }

  async function callConfirm(): Promise<string | null> {
    if (!draftId) return null;
    const r = await fetch(`/api/relic-drafts/${draftId}/confirm`, {
      method: "POST",
      credentials: "include",
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      throw new Error(j?.error || `confirm failed (${r.status})`);
    }
    const j = (await r.json()) as { slug?: string };
    return j.slug ?? null;
  }

  async function onSaveAndConfirm(next: DraftMetadata) {
    if (!draftId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/relic-drafts/${draftId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error || `save failed (${r.status})`);
      }
      const slug = await callConfirm();
      if (slug) router.push(`/relic-collection/${slug}`);
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.relicCollection.reviewBannerError);
      setBusy(false);
    }
  }

  async function onAbandon() {
    if (!draftId) {
      onClose();
      return;
    }
    if (!window.confirm(t.relicCollection.draftAbandonConfirm)) return;
    setBusy(true);
    setError(null);
    try {
      await fetch(`/api/relic-drafts/${draftId}`, {
        method: "DELETE",
        credentials: "include",
      });
      router.refresh();
      onClose();
    } catch (e) {
      console.error("[RelicDraftPanel] abandon failed", e);
      setError(t.relicCollection.draftPanelSubmitFailed);
      setBusy(false);
    }
  }

  async function onRetryGeneration() {
    if (!draftId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/relic-drafts/${draftId}/retry?fromStep=GENERATE_METADATA`,
        { method: "POST", credentials: "include" },
      );
      if (!r.ok) {
        throw new Error(`retry failed (${r.status})`);
      }
      setStage("waiting");
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.relicCollection.draftPanelSubmitFailed);
      setBusy(false);
    }
  }

  const slotLabel = format(t.relicCollection.cellSlot, { slot: String(slot).padStart(3, "0") });
  const canDismiss = !submitting && !busy;
  // For preview/failed/waiting stages, cancel button maps to "abandon" — we
  // never want admin to lose a draft just by closing. Stage 1 cancel is fine.
  const cancelHandler = stage === "upload" ? onClose : () => void onAbandon();

  return createPortal(
    <div
      role="dialog"
      aria-modal
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && canDismiss && stage === "upload") onClose();
      }}
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div
        className={[
          "relative w-full mt-12 mb-12 border border-primary/40 bg-surface-container/95",
          "shadow-[0_0_42px_rgba(140,255,225,0.18)] p-6 sm:p-8 space-y-6",
          // Preview stage hosts the 2-column editor; widen to match RelicForm.
          stage === "preview" ? "max-w-6xl" : "max-w-3xl",
        ].join(" ")}
      >
        {/* Preview + upload stages both have a bottom-bar 取消 button —
            skip the panel-level top-right cancel to match RelicForm's
            bottom-only pattern (no duplicate cancel paths). */}
        {stage !== "preview" && stage !== "upload" ? (
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <h2 className="text-primary text-2xl tracking-wider">
                {stage === "failed"
                  ? t.relicCollection.draftFailedTitle
                  : stage === "waiting"
                    ? t.relicCollection.draftWaitingTitle
                    : t.relicCollection.draftPanelTitle}
              </h2>
              <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant/75 mt-1">
                {slotLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={cancelHandler}
              disabled={!canDismiss}
              className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant/75 hover:text-on-surface disabled:opacity-40"
            >
              {t.relicCollection.draftPanelCancel}
            </button>
          </div>
        ) : null}

        {stage === "upload" ? (
          <form onSubmit={submitUpload} className="space-y-6">
            <p className="text-sm text-on-surface-variant leading-relaxed">
              {t.relicCollection.draftPanelSubtitle}
            </p>
            <div className="space-y-2">
              <label className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant">
                {t.relicCollection.draftPanelArchiveLabel}
              </label>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ACCEPT_ATTR}
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  setFiles((prev) => {
                    const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
                    const merged = [...prev];
                    for (const f of picked) {
                      const key = `${f.name}:${f.size}`;
                      if (!seen.has(key)) {
                        merged.push(f);
                        seen.add(key);
                      }
                    }
                    return merged.slice(0, MAX_FILES);
                  });
                  if (fileInput.current) fileInput.current.value = "";
                }}
                disabled={submitting}
                className="w-full text-sm text-on-surface file:mr-4 file:py-2 file:px-4 file:border file:border-primary/50 file:bg-transparent file:text-primary file:font-label file:text-[10px] file:tracking-[0.25em] file:uppercase file:cursor-pointer hover:file:bg-primary/10"
              />
              <p className="text-[11px] text-on-surface-variant/70">
                {t.relicCollection.draftPanelArchiveHint}
              </p>
              {files.length > 0 ? (
                <ul className="mt-2 space-y-1 text-[12px] text-on-surface-variant max-h-40 overflow-y-auto border border-primary/10 px-3 py-2">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3">
                      <span className="truncate">
                        {f.name}{" "}
                        <span className="text-on-surface-variant/60">({formatSize(f.size)})</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        disabled={submitting}
                        className="text-error/80 hover:text-error font-label text-[10px] tracking-[0.2em] uppercase shrink-0"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                  <li className="pt-1 border-t border-primary/10 text-on-surface-variant/60">
                    {files.length} / {MAX_FILES} · {formatSize(totalBytes)} /{" "}
                    {formatSize(MAX_TOTAL_BYTES)}
                  </li>
                </ul>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant">
                {t.relicCollection.draftPanelDescriptionLabel}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={submitting}
                maxLength={2000}
                rows={4}
                placeholder={t.relicCollection.draftPanelDescriptionPlaceholder}
                className="w-full bg-background/60 border border-primary/30 px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary resize-y"
              />
            </div>

            {error ? (
              <p className="text-sm text-error border border-error/30 bg-error/10 px-3 py-2">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-3 pt-2 border-t border-primary/20">
              <button
                type="button"
                onClick={() => !submitting && onClose()}
                disabled={submitting}
                className="px-4 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant border border-transparent hover:text-on-surface hover:border-on-surface-variant/40 hover:bg-on-surface/5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t.relicCollection.draftPanelCancel}
              </button>
              <button
                type="submit"
                disabled={submitting || files.length === 0}
                className="px-6 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-background bg-secondary hover:bg-secondary/90 cursor-pointer disabled:bg-on-surface-variant/30 disabled:text-on-surface-variant disabled:cursor-not-allowed"
              >
                {submitting
                  ? t.relicCollection.draftPanelSubmitting
                  : t.relicCollection.draftPanelSubmit}
              </button>
            </div>
          </form>
        ) : null}

        {stage === "waiting" ? (
          <div className="space-y-5 py-6">
            <p className="text-sm text-on-surface-variant leading-relaxed">
              {t.relicCollection.draftWaitingSubtitle}
            </p>
            <div className="border border-primary/20 bg-background/40 p-4 space-y-4">
              <div className="flex items-center gap-3">
                <span
                  className="material-symbols-outlined text-secondary text-[24px] animate-spin"
                  style={{ animationDuration: "2s" }}
                >
                  progress_activity
                </span>
                <span className="font-label text-[11px] tracking-[0.25em] uppercase text-secondary">
                  {format(t.relicCollection.draftWaitingProgress, {
                    progress: draft?.progress ?? 0,
                  })}
                </span>
              </div>
              <div className="h-1 bg-on-surface-variant/15 overflow-hidden">
                <div
                  className="h-full bg-secondary transition-all duration-700 ease-out"
                  style={{ width: `${Math.max(3, draft?.progress ?? 0)}%` }}
                />
              </div>
              <ul className="space-y-2 pt-1">
                {computeStages(draft, stage).map(({ id, status }) => {
                  const label = t.relicCollection.draftStageLabels[id];
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-3 font-label text-[11px] tracking-[0.18em]"
                    >
                      {status === "done" ? (
                        <span className="material-symbols-outlined text-secondary text-[18px] shrink-0">
                          check_circle
                        </span>
                      ) : status === "running" ? (
                        <span
                          className="material-symbols-outlined text-secondary text-[18px] shrink-0 animate-spin"
                          style={{ animationDuration: "2s" }}
                        >
                          progress_activity
                        </span>
                      ) : (
                        <span className="material-symbols-outlined text-on-surface-variant/40 text-[18px] shrink-0">
                          radio_button_unchecked
                        </span>
                      )}
                      <span
                        className={
                          status === "done"
                            ? "text-on-surface-variant"
                            : status === "running"
                              ? "text-on-surface"
                              : "text-on-surface-variant/50"
                        }
                      >
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void onAbandon()}
                disabled={busy}
                className="px-4 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-error border border-error/40 hover:bg-error/10 disabled:opacity-40"
              >
                {t.relicCollection.draftPreviewAbandon}
              </button>
            </div>
          </div>
        ) : null}

        {stage === "failed" ? (
          <div className="space-y-5 py-2">
            <p className="text-sm text-error border border-error/30 bg-error/10 px-3 py-2 leading-relaxed">
              {draft?.errorMessage ?? t.relicCollection.draftPanelSubmitFailed}
            </p>
            {error ? (
              <p className="text-sm text-error border border-error/30 bg-error/10 px-3 py-2">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-3 pt-2 border-t border-primary/20">
              <button
                type="button"
                onClick={() => void onAbandon()}
                disabled={busy}
                className="px-4 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-error border border-error/40 hover:bg-error/10 disabled:opacity-40"
              >
                {t.relicCollection.draftFailedAbandon}
              </button>
              <button
                type="button"
                onClick={() => void onRetryGeneration()}
                disabled={busy}
                className="px-5 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-background bg-secondary hover:bg-secondary/90 disabled:opacity-40"
              >
                {t.relicCollection.draftFailedRetry}
              </button>
            </div>
          </div>
        ) : null}

        {stage === "preview" && draftId && draft ? (
          <DraftPreviewBody
            draftId={draftId}
            slot={typeof draft.slot === "number" ? draft.slot : undefined}
            initial={draft.generatedMetadata ?? {}}
            busy={busy}
            error={error}
            onAbandon={() => void onAbandon()}
            onSaveAndConfirm={onSaveAndConfirm}
          />
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
