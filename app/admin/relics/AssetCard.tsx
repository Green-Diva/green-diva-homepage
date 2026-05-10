"use client";

// Compact asset management panel reused in DraftPreviewBody (review modal)
// and RelicForm (admin edit modal). Two-column layout — left: primary
// thumbnail + relic name/classif; right: a vertical checklist of three
// assets (原图 / 2D 增强 / 3D 立体) showing ✓ for generated and ◯ for
// missing, with inline trigger buttons for 2D/3D in edit mode.
//
// Heavy 3D viewing stays in the relic detail page — this card only shows
// generation status + a link out to the detail page when ready.

import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/types";
import Meshy3dConfigModal, { type Meshy3dOptions } from "./Meshy3dConfigModal";

type JobState =
  | { kind: "idle" }
  | { kind: "running"; jobId: string; startedAt: number }
  | { kind: "error"; message: string };

const POLL_MS = 3000;

type Props = {
  mode: "draft" | "edit";
  /**
   * Resource id used for asset URLs:
   * - draft: /api/relic-drafts/{resourceId}/primary
   * - edit:  /api/relics/{resourceId}/{primary,enhanced,model,asset-job}
   */
  resourceId: string;
  hasPrimary: boolean;
  hasEnhanced: boolean;
  hasModel: boolean;
  nameZh: string;
  nameEn: string;
  classifZh: string;
  classifEn: string;
  /** edit mode + admin only: enables 2D/3D trigger buttons */
  isAdmin: boolean;
  /** Slug for "view in detail page" link in edit mode */
  detailSlug?: string;
  /** Notify parent to refetch when an async job succeeds. */
  onAssetUpdated?: (kind: "enhanced" | "model") => void;
  t: Dictionary;
};

export default function AssetCard({
  mode,
  resourceId,
  hasPrimary,
  hasEnhanced,
  hasModel,
  nameZh,
  nameEn,
  classifZh,
  classifEn,
  isAdmin,
  detailSlug,
  onAssetUpdated,
  t,
}: Props) {
  const [enhanceJob, setEnhanceJob] = useState<JobState>({ kind: "idle" });
  const [modelJob, setModelJob] = useState<JobState>({ kind: "idle" });
  // Pre-flight 3D config dialog. Clicking the 3D row's "Start" button opens
  // it; the actual /create-3d POST only fires from inside its onConfirm.
  const [showMeshyConfig, setShowMeshyConfig] = useState(false);

  const enhanceJobRef = useRef(enhanceJob);
  const modelJobRef = useRef(modelJob);
  useEffect(() => {
    enhanceJobRef.current = enhanceJob;
  }, [enhanceJob]);
  useEffect(() => {
    modelJobRef.current = modelJob;
  }, [modelJob]);

  // Polling — only edit mode runs jobs.
  useEffect(() => {
    if (mode !== "edit") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    async function tick() {
      const e = enhanceJobRef.current;
      const m = modelJobRef.current;
      const running = e.kind === "running" ? e : m.kind === "running" ? m : null;
      if (!running) return;
      try {
        const r = await fetch(`/api/relics/${resourceId}/asset-job/${running.jobId}`, {
          credentials: "include",
        });
        if (cancelled) return;
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          const msg = j.error ?? `HTTP ${r.status}`;
          if (e.kind === "running" && e.jobId === running.jobId)
            setEnhanceJob({ kind: "error", message: msg });
          if (m.kind === "running" && m.jobId === running.jobId)
            setModelJob({ kind: "error", message: msg });
          return;
        }
        const data = (await r.json()) as {
          status: string;
          errorMessage?: string | null;
        };
        if (data.status === "SUCCESS") {
          if (e.kind === "running" && e.jobId === running.jobId) {
            setEnhanceJob({ kind: "idle" });
            onAssetUpdated?.("enhanced");
          }
          if (m.kind === "running" && m.jobId === running.jobId) {
            setModelJob({ kind: "idle" });
            onAssetUpdated?.("model");
          }
          return;
        }
        if (data.status === "FAILED" || data.status === "CANCELLED") {
          const msg = data.errorMessage ?? `job ${data.status.toLowerCase()}`;
          if (e.kind === "running" && e.jobId === running.jobId)
            setEnhanceJob({ kind: "error", message: msg });
          if (m.kind === "running" && m.jobId === running.jobId)
            setModelJob({ kind: "error", message: msg });
          return;
        }
        timer = setTimeout(tick, POLL_MS);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "poll failed";
        if (e.kind === "running") setEnhanceJob({ kind: "error", message: msg });
        if (m.kind === "running") setModelJob({ kind: "error", message: msg });
      }
    }
    if (enhanceJob.kind === "running" || modelJob.kind === "running") {
      timer = setTimeout(tick, POLL_MS);
    }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enhanceJob, modelJob, resourceId, onAssetUpdated, mode]);

  async function startEnhance() {
    setEnhanceJob({ kind: "running", jobId: "...", startedAt: Date.now() });
    try {
      const r = await fetch(`/api/relics/${resourceId}/enhance-2d`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setEnhanceJob({ kind: "error", message: j.error ?? `HTTP ${r.status}` });
        return;
      }
      const j = (await r.json()) as { jobId: string };
      setEnhanceJob({ kind: "running", jobId: j.jobId, startedAt: Date.now() });
    } catch (err) {
      setEnhanceJob({
        kind: "error",
        message: err instanceof Error ? err.message : "request failed",
      });
    }
  }

  async function startCreate3d(opts: Meshy3dOptions) {
    setShowMeshyConfig(false);
    setModelJob({ kind: "running", jobId: "...", startedAt: Date.now() });
    try {
      const r = await fetch(`/api/relics/${resourceId}/create-3d`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setModelJob({ kind: "error", message: j.error ?? `HTTP ${r.status}` });
        return;
      }
      const j = (await r.json()) as { jobId: string };
      setModelJob({ kind: "running", jobId: j.jobId, startedAt: Date.now() });
    } catch (err) {
      setModelJob({
        kind: "error",
        message: err instanceof Error ? err.message : "request failed",
      });
    }
  }

  // Idle entry: opens the config dialog. Re-trigger from the error state's
  // "retry" button also goes through here so admin can adjust options after
  // a Meshy failure (e.g. drop polycount, switch model_type).
  function openCreate3dDialog() {
    setShowMeshyConfig(true);
  }

  const isDraft = mode === "draft";
  const primaryUrl = isDraft
    ? `/api/relic-drafts/${resourceId}/primary`
    : `/api/relics/${resourceId}/primary`;
  const enhancedThumbUrl = `/api/relics/${resourceId}/enhanced`;
  const model3dGated = !hasEnhanced && !hasModel;

  return (
    <div className="border border-primary/20 bg-background/40 p-3">
      <div className="flex flex-col sm:flex-row gap-4 sm:items-stretch">
        {/* Left — primary thumbnail + name + classif */}
        <div className="flex sm:flex-col items-center sm:items-start gap-3 sm:gap-3 sm:w-44 shrink-0">
          {hasPrimary ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={primaryUrl}
              alt=""
              className="w-24 h-24 sm:w-full sm:h-auto sm:aspect-square object-cover bg-background shrink-0"
            />
          ) : (
            <div className="w-24 h-24 sm:w-full sm:h-auto sm:aspect-square bg-background border border-primary/20 shrink-0 flex items-center justify-center">
              <span className="material-symbols-outlined text-on-surface-variant/40">
                image
              </span>
            </div>
          )}
          <div className="min-w-0 flex-1 sm:flex-none sm:w-full">
            <p className="font-headline text-lg text-primary truncate">
              {nameZh || nameEn || "—"}
            </p>
            <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant truncate">
              {classifZh || classifEn || "—"}
            </p>
          </div>
        </div>

        {/* Right — asset checklist */}
        <ul className="flex-1 flex flex-col gap-1 sm:border-l sm:border-primary/15 sm:pl-4">
          {/* 原图 — read-only status */}
          <AssetRow
            label={t.relicCollection.tabOriginal}
            done={hasPrimary}
          >
            <StatusText
              text={hasPrimary ? t.relicCollection.assetReady : t.relicCollection.assetMissing}
              tone={hasPrimary ? "ok" : "muted"}
            />
          </AssetRow>

          {/* 2D 增强 */}
          <AssetRow
            label={t.relicCollection.tab2dEnhance}
            done={hasEnhanced}
            running={enhanceJob.kind === "running"}
            errored={enhanceJob.kind === "error"}
          >
            <AssetRowAction
              isDraft={isDraft}
              isAdmin={isAdmin}
              hasIt={hasEnhanced}
              jobState={enhanceJob}
              onStart={startEnhance}
              etaText={t.relicCollection.enhanceEta}
              startLabel={t.relicCollection.enhanceStart}
              runningLabel={t.relicCollection.enhanceRunning}
              thumbnailWhenReady={enhancedThumbUrl}
              t={t}
            />
          </AssetRow>

          {/* 3D 立体 */}
          <AssetRow
            label={t.relicCollection.tab3dModel}
            done={hasModel}
            running={modelJob.kind === "running"}
            errored={modelJob.kind === "error"}
          >
            <AssetRowAction
              isDraft={isDraft}
              isAdmin={isAdmin}
              hasIt={hasModel}
              jobState={modelJob}
              onStart={openCreate3dDialog}
              etaText={t.relicCollection.create3dEta}
              startLabel={t.relicCollection.create3dStart}
              runningLabel={t.relicCollection.create3dRunning}
              disabledByGate={model3dGated && !hasModel}
              gateMessage={t.relicCollection.tab3dRequires2d}
              detailHref={
                hasModel && detailSlug && !isDraft
                  ? `/relic-collection/${detailSlug}?view=model3d`
                  : undefined
              }
              t={t}
            />
          </AssetRow>
        </ul>
      </div>

      {showMeshyConfig ? (
        <Meshy3dConfigModal
          t={t}
          onCancel={() => setShowMeshyConfig(false)}
          onConfirm={(opts) => void startCreate3d(opts)}
        />
      ) : null}
    </div>
  );
}

/** One row in the right-hand checklist: status icon + label + slot for action/status. */
function AssetRow({
  label,
  done,
  running,
  errored,
  children,
}: {
  label: string;
  done: boolean;
  running?: boolean;
  errored?: boolean;
  children: React.ReactNode;
}) {
  let icon: React.ReactNode;
  if (errored) {
    icon = (
      <span className="material-symbols-outlined text-error text-[20px] shrink-0">
        error
      </span>
    );
  } else if (running) {
    icon = (
      <span
        className="material-symbols-outlined text-secondary text-[20px] shrink-0 animate-spin"
        style={{ animationDuration: "2s" }}
      >
        progress_activity
      </span>
    );
  } else if (done) {
    icon = (
      <span className="material-symbols-outlined text-secondary text-[20px] shrink-0">
        check_circle
      </span>
    );
  } else {
    icon = (
      <span className="material-symbols-outlined text-on-surface-variant/40 text-[20px] shrink-0">
        radio_button_unchecked
      </span>
    );
  }
  const labelTone = done
    ? "text-secondary"
    : running
      ? "text-on-surface"
      : errored
        ? "text-error"
        : "text-on-surface-variant";
  return (
    <li className="flex items-center gap-3 py-1.5 min-h-[36px]">
      {icon}
      <span
        className={`font-label text-[11px] tracking-[0.22em] uppercase shrink-0 w-[72px] ${labelTone}`}
      >
        {label}
      </span>
      <div className="flex-1 min-w-0 flex items-center justify-end gap-2">
        {children}
      </div>
    </li>
  );
}

function StatusText({
  text,
  tone,
}: {
  text: string;
  tone: "ok" | "muted" | "warn" | "err";
}) {
  const cls =
    tone === "ok"
      ? "text-secondary"
      : tone === "warn"
        ? "text-secondary/70"
        : tone === "err"
          ? "text-error"
          : "text-on-surface-variant/60";
  return (
    <span className={`font-label text-[10px] tracking-[0.2em] uppercase ${cls}`}>
      {text}
    </span>
  );
}

function AssetRowAction({
  isDraft,
  isAdmin,
  hasIt,
  jobState,
  onStart,
  etaText,
  startLabel,
  runningLabel,
  thumbnailWhenReady,
  detailHref,
  disabledByGate,
  gateMessage,
  t,
}: {
  isDraft: boolean;
  isAdmin: boolean;
  hasIt: boolean;
  jobState: JobState;
  onStart: () => void;
  etaText: string;
  startLabel: string;
  runningLabel: string;
  thumbnailWhenReady?: string;
  detailHref?: string;
  disabledByGate?: boolean;
  gateMessage?: string;
  t: Dictionary;
}) {
  if (hasIt) {
    return (
      <>
        {thumbnailWhenReady ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={thumbnailWhenReady}
            alt=""
            className="w-7 h-7 object-contain shrink-0"
            style={{
              background:
                "repeating-conic-gradient(#1a1c1c 0% 25%, #0d0f0f 25% 50%) 50% / 4px 4px",
            }}
          />
        ) : null}
        {detailHref ? (
          <a
            href={detailHref}
            target="_blank"
            rel="noopener"
            className="font-label text-[10px] tracking-[0.2em] uppercase text-primary hover:underline truncate"
          >
            {t.relicCollection.assetViewInDetail} →
          </a>
        ) : (
          <StatusText text={t.relicCollection.assetReady} tone="ok" />
        )}
      </>
    );
  }
  if (jobState.kind === "running") {
    return (
      <span
        className="relative overflow-hidden font-label text-[10px] tracking-[0.2em] uppercase text-secondary px-2 py-1"
        title={etaText}
      >
        <span className="absolute inset-0 bg-gradient-to-r from-transparent via-secondary/15 to-transparent animate-[scan_2.4s_linear_infinite]" />
        <span className="relative z-10">{runningLabel}</span>
      </span>
    );
  }
  if (jobState.kind === "error") {
    return (
      <>
        <span
          className="font-label text-[10px] tracking-[0.2em] uppercase text-error truncate"
          title={jobState.message}
        >
          {t.relicCollection.generateFailed}
        </span>
        {isAdmin ? (
          <button
            type="button"
            onClick={onStart}
            className="px-2 py-1 border border-secondary/60 text-secondary font-label text-[10px] tracking-[0.2em] uppercase hover:bg-secondary/10 shrink-0"
          >
            {t.relicCollection.generateRetry}
          </button>
        ) : null}
      </>
    );
  }
  // idle — not generated
  if (isDraft) {
    return <StatusText text={t.relicCollection.assetDraftLocked} tone="muted" />;
  }
  if (!isAdmin) {
    return <StatusText text={t.relicCollection.assetMissing} tone="muted" />;
  }
  if (disabledByGate) {
    return <StatusText text={gateMessage ?? t.relicCollection.assetMissing} tone="muted" />;
  }
  return (
    <button
      type="button"
      onClick={onStart}
      title={etaText}
      className="px-3 py-1 border border-secondary/60 text-secondary font-label text-[10px] tracking-[0.2em] uppercase hover:bg-secondary/10 shrink-0"
    >
      ▷ {startLabel}
    </button>
  );
}
