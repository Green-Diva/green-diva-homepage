"use client";

// Compact asset management panel reused in DraftPreviewBody (review modal)
// and RelicForm (admin edit modal). Two-column layout — left: primary
// thumbnail + relic name/classif; right: a vertical checklist of three
// assets (原图 / 2D 增强 / 3D 立体) showing ✓ for generated and ◯ for
// missing, with inline trigger buttons for 2D/3D in edit mode.
//
// Heavy 3D viewing stays in the relic detail page — this card only shows
// generation status + a link out to the detail page when ready.
//
// 2D enhance is multi-job (admin batches N candidates at once via the
// dual-column Cutout2dConfigModal); we track concurrent enhance jobs in
// a Map and surface a "running N" badge. 3D stays single-job.

import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/types";
import Meshy3dConfigModal, { type Meshy3dOptions } from "./Meshy3dConfigModal";
import Cutout2dConfigModal, {
  type Cutout2dBatchPayload,
  type CutoutCandidateInput,
  type CutoutEnhancedInput,
} from "./Cutout2dConfigModal";

type JobState =
  | { kind: "idle" }
  | { kind: "running"; jobId: string; startedAt: number }
  | { kind: "error"; message: string };

type EnhanceJobEntry = { jobId: string; startedAt: number; candidatePath?: string };

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
  /** Unsaved primary path (from form state). When set, the thumbnail
   * resolves via /candidate?path=… instead of /primary so admin can
   * preview a re-ordered/replaced primary before saving. */
  primaryPathOverride?: string | null;
  /** edit mode + admin only: enables 2D/3D trigger buttons */
  isAdmin: boolean;
  /** Slug for "view in detail page" link in edit mode */
  detailSlug?: string;
  /** Notify parent to refetch when an async job succeeds. */
  onAssetUpdated?: (kind: "enhanced" | "model") => void;
  /** Non-deleted candidate pool for the 2D enhance modal's source picker.
   * Pass empty in draft mode. */
  candidates?: CutoutCandidateInput[];
  /** Current Relic.enhancedImages history for the modal's lower grid. */
  enhancedItems?: CutoutEnhancedInput[];
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
  primaryPathOverride,
  isAdmin,
  detailSlug,
  onAssetUpdated,
  candidates,
  enhancedItems,
  t,
}: Props) {
  // Multi-job: 2D enhance can fan out to N AgentJobs (one per source).
  // Map keyed on jobId; size 0 means no enhance in flight.
  const [enhanceJobs, setEnhanceJobs] = useState<Map<string, EnhanceJobEntry>>(
    () => new Map(),
  );
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [modelJob, setModelJob] = useState<JobState>({ kind: "idle" });
  const [showMeshyConfig, setShowMeshyConfig] = useState(false);
  const [showCutoutConfig, setShowCutoutConfig] = useState(false);

  const enhanceRunningCount = enhanceJobs.size;
  const enhanceJobsRef = useRef(enhanceJobs);
  const modelJobRef = useRef(modelJob);
  useEffect(() => {
    enhanceJobsRef.current = enhanceJobs;
  }, [enhanceJobs]);
  useEffect(() => {
    modelJobRef.current = modelJob;
  }, [modelJob]);

  // Polling — only edit mode runs jobs.
  useEffect(() => {
    if (mode !== "edit") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    async function pollOne(jobId: string): Promise<{
      status: string;
      errorMessage?: string | null;
    } | null> {
      const r = await fetch(`/api/relics/${resourceId}/asset-job/${jobId}`, {
        credentials: "include",
      });
      if (!r.ok) {
        return null;
      }
      return (await r.json()) as { status: string; errorMessage?: string | null };
    }

    async function tick() {
      const enhanceRunning = enhanceJobsRef.current;
      const m = modelJobRef.current;
      let anyEnhanceDone = false;
      let anyModelDone = false;

      if (enhanceRunning.size > 0) {
        const results = await Promise.all(
          Array.from(enhanceRunning.values()).map((e) =>
            pollOne(e.jobId).then((d) => ({ entry: e, data: d })),
          ),
        );
        if (cancelled) return;
        const nextMap = new Map(enhanceRunning);
        let lastError: string | null = null;
        for (const { entry, data } of results) {
          if (!data) continue;
          if (data.status === "SUCCESS") {
            nextMap.delete(entry.jobId);
            anyEnhanceDone = true;
            continue;
          }
          if (data.status === "FAILED" || data.status === "CANCELLED") {
            nextMap.delete(entry.jobId);
            lastError = data.errorMessage ?? `job ${data.status.toLowerCase()}`;
            anyEnhanceDone = true;
            continue;
          }
        }
        setEnhanceJobs(nextMap);
        if (lastError) setEnhanceError(lastError);
        if (anyEnhanceDone) onAssetUpdated?.("enhanced");
      }

      if (m.kind === "running") {
        const data = await pollOne(m.jobId);
        if (cancelled) return;
        if (data) {
          if (data.status === "SUCCESS") {
            setModelJob({ kind: "idle" });
            anyModelDone = true;
            onAssetUpdated?.("model");
          } else if (data.status === "FAILED" || data.status === "CANCELLED") {
            setModelJob({
              kind: "error",
              message: data.errorMessage ?? `job ${data.status.toLowerCase()}`,
            });
          }
        }
      }

      void anyModelDone;
      if (
        !cancelled &&
        (enhanceJobsRef.current.size > 0 || modelJobRef.current.kind === "running")
      ) {
        timer = setTimeout(tick, POLL_MS);
      }
    }

    if (enhanceJobs.size > 0 || modelJob.kind === "running") {
      timer = setTimeout(tick, POLL_MS);
    }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enhanceJobs, modelJob, resourceId, onAssetUpdated, mode]);

  async function startEnhance(payload: Cutout2dBatchPayload) {
    // Don't auto-close the modal — admin stays in it during runtime so
    // they can watch the per-job progress under step 1 and see results
    // populate step 3. They close via the step-3 "完成" button.
    setEnhanceError(null);
    try {
      const r = await fetch(`/api/relics/${resourceId}/enhance-2d`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setEnhanceError(j.error ?? `HTTP ${r.status}`);
        return;
      }
      const j = (await r.json()) as {
        jobs?: Array<{ jobId?: string; candidatePath?: string; error?: string }>;
      };
      const next = new Map<string, EnhanceJobEntry>(enhanceJobs);
      let anyError: string | null = null;
      for (const job of j.jobs ?? []) {
        if (job.jobId) {
          next.set(job.jobId, {
            jobId: job.jobId,
            startedAt: Date.now(),
            candidatePath: job.candidatePath,
          });
        } else if (job.error) {
          anyError = job.error;
        }
      }
      setEnhanceJobs(next);
      if (anyError) setEnhanceError(anyError);
    } catch (err) {
      setEnhanceError(err instanceof Error ? err.message : "request failed");
    }
  }

  async function startCreate3d(opts: Meshy3dOptions, selectedPaths: string[]) {
    setShowMeshyConfig(false);
    setModelJob({ kind: "running", jobId: "...", startedAt: Date.now() });
    try {
      const body = {
        ...opts,
        ...(selectedPaths.length > 0
          ? { items: selectedPaths.map((p) => ({ enhancedPath: p })) }
          : {}),
      };
      const r = await fetch(`/api/relics/${resourceId}/create-3d`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  async function uploadGlb(file: File) {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch(`/api/relics/${resourceId}/model/upload`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `HTTP ${r.status}`);
    }
    // Same parent refresh path as a finished Meshy job — the new modelPath
    // flows back through refetchRelic → AssetCard hasModel prop → modal
    // step 3 re-renders with the freshly-uploaded GLB.
    onAssetUpdated?.("model");
  }

  async function deleteEnhancedItem(path: string) {
    try {
      const r = await fetch(
        `/api/relics/${resourceId}/enhanced-item?path=${encodeURIComponent(path)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!r.ok) {
        console.warn("[AssetCard] delete enhanced-item failed", await r.text());
        return;
      }
      onAssetUpdated?.("enhanced");
    } catch (e) {
      console.warn("[AssetCard] delete enhanced-item threw", e);
    }
  }

  function openCreate3dDialog() {
    setShowMeshyConfig(true);
  }
  function openEnhance2dDialog() {
    setShowCutoutConfig(true);
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
    : primaryPathOverride
      ? `/api/relics/${resourceId}/candidate?path=${encodeURIComponent(primaryPathOverride)}`
      : `/api/relics/${resourceId}/primary`;
  const model3dGated = !hasEnhanced && !hasModel;

  // Synthetic JobState for the 2D chip — preserves the existing AssetChip
  // contract (one JobState per chip) while we track N concurrent jobs
  // internally. Status precedence: error > running > idle.
  // startedAt is unread by AssetChip — feeding 0 keeps render pure
  // (Date.now in render is a react-hooks/impure-function lint error).
  const enhanceChipState: JobState =
    enhanceError && enhanceRunningCount === 0
      ? { kind: "error", message: enhanceError }
      : enhanceRunningCount > 0
        ? { kind: "running", jobId: "(batch)", startedAt: 0 }
        : { kind: "idle" };
  const enhanceRunningLabel =
    enhanceRunningCount > 1
      ? `${t.relicCollection.enhanceRunning} · ${enhanceRunningCount}`
      : t.relicCollection.enhanceRunning;

  return (
    <div className="border border-primary/20 bg-background/40 p-3">
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

        <div className="flex items-center gap-2 shrink-0 pl-3 ml-auto border-l border-primary/15">
          <AssetChip
            label={t.relicCollection.tab2dEnhance}
            done={hasEnhanced}
            running={enhanceRunningCount > 0}
            errored={enhanceChipState.kind === "error"}
            isDraft={isDraft}
            isAdmin={isAdmin}
            jobState={enhanceChipState}
            onStart={openEnhance2dDialog}
            etaText={t.relicCollection.enhanceEta}
            startLabel={t.relicCollection.enhanceStart}
            runningLabel={enhanceRunningLabel}
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
            t={t}
          />
        </div>
      </div>

      {showMeshyConfig ? (
        <Meshy3dConfigModal
          t={t}
          onCancel={() => setShowMeshyConfig(false)}
          onConfirm={(opts, selectedPaths) => void startCreate3d(opts, selectedPaths)}
          enhancedItems={(enhancedItems ?? []).map((e) => ({
            path: e.path,
            sourceCandidatePath: e.sourceCandidatePath,
            model: e.model,
            operatingResolution: e.operatingResolution,
            createdAt: e.createdAt,
          }))}
          enhancedThumbUrl={(p) =>
            `/api/relics/${resourceId}/enhanced?path=${encodeURIComponent(p)}`
          }
          hasModel={hasModel}
          running={modelJob.kind === "running"}
          modelUrl={hasModel ? `/api/relics/${resourceId}/model` : undefined}
          modelAlt={nameZh || nameEn || undefined}
          onUploadGlb={uploadGlb}
        />
      ) : null}
      {showCutoutConfig ? (
        <Cutout2dConfigModal
          t={t}
          relicId={resourceId}
          candidates={candidates ?? []}
          enhancedItems={enhancedItems ?? []}
          candidateThumbUrl={(p) =>
            `/api/relics/${resourceId}/candidate?path=${encodeURIComponent(p)}`
          }
          enhancedThumbUrl={(p) =>
            `/api/relics/${resourceId}/enhanced?path=${encodeURIComponent(p)}`
          }
          onEnhancedDelete={deleteEnhancedItem}
          runningJobs={Array.from(enhanceJobs.values()).map((e) => ({
            jobId: e.jobId,
            candidatePath: e.candidatePath,
          }))}
          runningError={enhanceError}
          onCancel={() => setShowCutoutConfig(false)}
          onConfirm={(payload) => void startEnhance(payload)}
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
  startLabel: _startLabel,
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
  void _startLabel;
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

  const displayLabel = running && runningLabel ? runningLabel : label;
  const labelTone = done
    ? "text-secondary"
    : errored
      ? "text-error"
      : running
        ? "text-on-surface"
        : "text-on-surface-variant";

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
    // Even when done, allow admin to open the dialog for re-enhance.
    if (isAdmin && !isDraft && !disabledByGate && onStart) {
      clickable = onStart;
    }
  } else if (jobState?.kind === "running") {
    title = etaText;
  } else if (jobState?.kind === "error") {
    title = jobState.message;
    if (isAdmin && onStart) clickable = onStart;
  } else {
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
      <span className={labelTone}>{displayLabel}</span>
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
