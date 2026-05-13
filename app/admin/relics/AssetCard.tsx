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
  iconKey?: string | null;
  rarity?: "COMMON" | "RARE" | "EPIC" | "LEGENDARY" | "SPECIAL";
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
  iconKey,
  rarity,
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

  const rarityAccent =
    rarity === "RARE"
      ? "text-[#80c8ff]"
      : rarity === "EPIC"
        ? "text-[#c79bff]"
        : rarity === "LEGENDARY"
          ? "text-secondary"
          : rarity === "SPECIAL"
            ? "text-[#ff9bcd]"
            : "text-primary";

  const isDraft = mode === "draft";
  const primaryUrl = isDraft
    ? `/api/relic-drafts/${resourceId}/primary`
    : `/api/relics/${resourceId}/primary`;
  const enhancedThumbUrl = `/api/relics/${resourceId}/enhanced`;
  const model3dGated = !hasEnhanced && !hasModel;

  return (
    <div className="border border-primary/20 bg-background/40 p-3">
      {/* Single-row layout: thumbnail + icon + name/classif + asset chips */}
      <div className="flex items-center gap-3">
        {hasPrimary ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={primaryUrl}
            alt=""
            className="w-10 h-10 object-cover bg-background shrink-0"
          />
        ) : (
          <div className="w-10 h-10 bg-background border border-primary/20 shrink-0 flex items-center justify-center">
            <span className="material-symbols-outlined text-on-surface-variant/40">
              image
            </span>
          </div>
        )}
        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
          <p className={"font-headline text-base truncate flex items-center gap-1.5 leading-tight " + rarityAccent}>
            <span className="truncate">{nameZh || nameEn || "—"}</span>
            <span
              className={"material-symbols-outlined text-[20px] shrink-0 " + rarityAccent}
              style={{ fontVariationSettings: "'FILL' 0, 'wght' 200" }}
            >
              {iconKey || "inventory_2"}
            </span>
          </p>
          <p className="font-label text-[10px] tracking-[0.2em] uppercase text-on-surface-variant truncate leading-tight">
            {classifZh || classifEn || "—"}
          </p>
        </div>

        {/* Asset chips — compact inline */}
        <div className="flex items-center gap-2 shrink-0 pl-3 ml-auto border-l border-primary/15">
          <AssetChip
            label={t.relicCollection.tabOriginal}
            done={hasPrimary}
          />
          <AssetChip
            label={t.relicCollection.tab2dEnhance}
            done={hasEnhanced}
            running={enhanceJob.kind === "running"}
            errored={enhanceJob.kind === "error"}
            isDraft={isDraft}
            isAdmin={isAdmin}
            jobState={enhanceJob}
            onStart={startEnhance}
            etaText={t.relicCollection.enhanceEta}
            startLabel={t.relicCollection.enhanceStart}
            runningLabel={t.relicCollection.enhanceRunning}
            thumbnailWhenReady={enhancedThumbUrl}
            t={t}
          />
          <AssetChip
            label={t.relicCollection.tab3dModel}
            done={hasModel}
            running={modelJob.kind === "running"}
            errored={modelJob.kind === "error"}
            isDraft={isDraft}
            isAdmin={isAdmin}
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
        </div>
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

/** Compact horizontal chip — status icon + label + optional thumb/action. */
function AssetChip({
  label,
  done,
  running,
  errored,
  isDraft,
  isAdmin,
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
  label: string;
  done: boolean;
  running?: boolean;
  errored?: boolean;
  isDraft?: boolean;
  isAdmin?: boolean;
  jobState?: JobState;
  onStart?: () => void;
  etaText?: string;
  startLabel?: string;
  runningLabel?: string;
  thumbnailWhenReady?: string;
  detailHref?: string;
  disabledByGate?: boolean;
  gateMessage?: string;
  t?: Dictionary;
}) {
  let icon: React.ReactNode;
  if (errored) {
    icon = (
      <span className="material-symbols-outlined text-error text-[16px] shrink-0">
        error
      </span>
    );
  } else if (running) {
    icon = (
      <span
        className="material-symbols-outlined text-secondary text-[16px] shrink-0 animate-spin"
        style={{ animationDuration: "2s" }}
      >
        progress_activity
      </span>
    );
  } else if (done) {
    icon = (
      <span className="material-symbols-outlined text-secondary text-[16px] shrink-0">
        check_circle
      </span>
    );
  } else {
    icon = (
      <span className="material-symbols-outlined text-on-surface-variant/40 text-[16px] shrink-0">
        radio_button_unchecked
      </span>
    );
  }

  const labelTone = done
    ? "text-secondary"
    : errored
      ? "text-error"
      : running
        ? "text-on-surface"
        : "text-on-surface-variant";

  // Determine right-side trailing element
  let trailing: React.ReactNode = null;
  let title: string | undefined;
  let clickable: (() => void) | null = null;

  if (done) {
    if (thumbnailWhenReady) {
      trailing = (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={thumbnailWhenReady}
          alt=""
          className="w-5 h-5 object-contain shrink-0"
          style={{
            background:
              "repeating-conic-gradient(#1a1c1c 0% 25%, #0d0f0f 25% 50%) 50% / 4px 4px",
          }}
        />
      );
    } else if (detailHref) {
      trailing = (
        <a
          href={detailHref}
          target="_blank"
          rel="noopener"
          onClick={(e) => e.stopPropagation()}
          className="material-symbols-outlined text-primary text-[16px] hover:opacity-70"
        >
          open_in_new
        </a>
      );
    }
  } else if (jobState?.kind === "running") {
    title = etaText;
  } else if (jobState?.kind === "error") {
    title = jobState.message;
    if (isAdmin && onStart) clickable = onStart;
  } else {
    // idle
    if (!isDraft && isAdmin && !disabledByGate && onStart) {
      clickable = onStart;
      title = etaText;
    } else if (disabledByGate) {
      title = gateMessage;
    } else if (isDraft) {
      title = t?.relicCollection.assetDraftLocked;
    }
  }

  const baseCls =
    "inline-flex items-center gap-1.5 px-2 py-1 border font-label text-[10px] tracking-[0.22em] uppercase shrink-0 whitespace-nowrap " +
    (errored
      ? "border-error/40"
      : done
        ? "border-secondary/40"
        : running
          ? "border-secondary/40"
          : clickable
            ? "border-secondary/60 hover:bg-secondary/10 cursor-pointer text-secondary"
            : "border-on-surface-variant/20");

  const content = (
    <>
      {icon}
      <span className={labelTone}>{label}</span>
      {trailing}
    </>
  );

  if (clickable) {
    return (
      <button type="button" onClick={clickable} title={title} className={baseCls}>
        {content}
      </button>
    );
  }
  return (
    <span title={title} className={baseCls}>
      {content}
    </span>
  );
}
