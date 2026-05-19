"use client";

// 3-tab asset switcher rendered in the relic detail page's image area.
// Tabs: 原图 / 2D 增强 / 3D 立体
//
// - "原图": carousel through primary + non-primary candidates (max 16).
// - "2D 增强": carousel through Relic.enhancedImages array (max 16). Admin
//   click "生成" opens the dual-column Cutout2dConfigModal for batch enhance;
//   multiple AgentJobs run concurrently, all polled below.
// - "3D 立体": disabled until enhancedImages has at least one entry; admin
//   click "生成" opens Meshy3dConfigModal → /create-3d → /model.
//
// Tab state via URL ?view= so back/forward feels right; default chosen by
// asset availability (enhanced > model3d > original).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import type { Dictionary } from "@/lib/i18n/types";
import Meshy3dConfigModal, { type Meshy3dOptions } from "@/app/admin/relics/Meshy3dConfigModal";
import Cutout2dConfigModal, {
  type Cutout2dBatchPayload,
  type CutoutCandidateInput,
} from "@/app/admin/relics/Cutout2dConfigModal";

// RelicViewer is a heavy import (model-viewer custom element). Lazy-load
// so the original-tab path doesn't pay for it.
const RelicViewer = dynamic(() => import("./RelicViewer"), { ssr: false });

type TabKey = "original" | "enhance2d" | "model3d";

// Carousel item for the "原图" tab. The hero is always index 0 (primary
// image, served via /primary). Subsequent items are non-deleted, non-
// primary candidates capped at 15 to keep the total ≤ 16.
export type OriginCarouselItem = {
  kind: "primary" | "user" | "network";
  path: string | null;
  sourceUrl?: string;
};

// One entry from Relic.enhancedImages. AssetTabs renders these in a
// carousel; tooltip text comes from model/operatingResolution/refine.
export type EnhancedImageItem = {
  path: string;
  sourceCandidatePath: string;
  model: string;
  operatingResolution: string;
  refineForeground: boolean;
  createdAt: string;
};

type Props = {
  relicId: string;
  hasModel: boolean;
  alt: string;
  isAdmin: boolean;
  t: Dictionary;
  originItems: OriginCarouselItem[];
  // Already-capped (max 16) array from Relic.enhancedImages.
  enhancedItems: EnhancedImageItem[];
  // Non-deleted candidates (user + network). Threaded to Cutout2dConfigModal
  // as the multi-select source pool. Order is the server's natural order
  // (the modal re-sorts user → network internally).
  candidatesForEnhance: CutoutCandidateInput[];
};

type SingleJobState =
  | { kind: "idle" }
  | {
      kind: "running";
      jobId: string;
      startedAt: number;
      slaMs: number | null;
      progressPercent?: number | null;
      progressLabel?: string | null;
    }
  | { kind: "error"; message: string };

type EnhanceJobEntry = {
  jobId: string;
  startedAt: number;
  slaMs: number | null;
  progressPercent: number | null;
  progressLabel: string | null;
  candidatePath?: string;
};

const POLL_MS = 3000;

export default function AssetTabs({
  relicId,
  hasModel,
  alt,
  isAdmin,
  t,
  originItems,
  enhancedItems,
  candidatesForEnhance,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();

  const hasPrimary = originItems.some((i) => i.kind === "primary");
  const hasEnhanced = enhancedItems.length > 0;

  const defaultTab = useMemo<TabKey>(() => {
    const requested = params.get("view");
    if (requested === "enhance2d" || requested === "original" || requested === "model3d") {
      return requested;
    }
    if (hasModel) return "model3d";
    if (hasEnhanced) return "enhance2d";
    return "original";
  }, [params, hasModel, hasEnhanced]);

  const [active, setActive] = useState<TabKey>(defaultTab);
  // Multi-job: enhance can fan out to N AgentJobs (one per source). We
  // track them in a map keyed on jobId so each progresses independently.
  const [enhanceJobs, setEnhanceJobs] = useState<Map<string, EnhanceJobEntry>>(
    () => new Map(),
  );
  // Last batch error (used for the chip's error state). Cleared on a fresh
  // batch start.
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [modelJob, setModelJob] = useState<SingleJobState>({ kind: "idle" });
  const [show3dConfig, setShow3dConfig] = useState(false);
  const [show2dConfig, setShow2dConfig] = useState(false);
  const [originIdx, setOriginIdx] = useState(0);
  const [enhanceIdx, setEnhanceIdx] = useState(0);

  const enhanceRunningCount = enhanceJobs.size;

  // Keyboard ← / → cycle while on the original tab. No-op when only
  // one image, or when focus is in a form field (avoid hijacking).
  useEffect(() => {
    if (active === "original" && originItems.length > 1) {
      const handler = (e: KeyboardEvent) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        setOriginIdx((i) => {
          const n = originItems.length;
          return e.key === "ArrowLeft" ? (i - 1 + n) % n : (i + 1) % n;
        });
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }
    if (active === "enhance2d" && enhancedItems.length > 1) {
      const handler = (e: KeyboardEvent) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        setEnhanceIdx((i) => {
          const n = enhancedItems.length;
          return e.key === "ArrowLeft" ? (i - 1 + n) % n : (i + 1) % n;
        });
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }
    return undefined;
  }, [active, originItems.length, enhancedItems.length]);

  const setTab = useCallback(
    (next: TabKey) => {
      setActive(next);
      const sp = new URLSearchParams(params.toString());
      if (next === "original") sp.delete("view");
      else sp.set("view", next);
      router.replace(`?${sp.toString()}`, { scroll: false });
    },
    [params, router],
  );

  // On mount (admin only), restore in-flight job state from the server so
  // a refresh mid-batch doesn't drop the running spinners.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/relics/${relicId}/active-jobs`, { credentials: "include" });
        if (!r.ok || cancelled) return;
        const data = (await r.json()) as {
          enhance: Array<{
            jobId: string;
            status: string;
            errorMessage: string | null;
            startedAt: string | null;
            slaMs: number | null;
            progressPercent: number | null;
            progressLabel: string | null;
            sourceCandidatePath: string | null;
          }>;
          model: {
            jobId: string;
            status: string;
            errorMessage: string | null;
            startedAt: string | null;
            slaMs: number | null;
            progressPercent: number | null;
            progressLabel: string | null;
          } | null;
        };
        if (Array.isArray(data.enhance) && data.enhance.length > 0) {
          const next = new Map<string, EnhanceJobEntry>();
          for (const j of data.enhance) {
            if (j.status !== "RUNNING" && j.status !== "PENDING") continue;
            const startedAt = j.startedAt ? new Date(j.startedAt).getTime() : Date.now();
            if (j.slaMs != null && Date.now() - startedAt > j.slaMs) continue;
            next.set(j.jobId, {
              jobId: j.jobId,
              startedAt,
              slaMs: j.slaMs,
              progressPercent: j.progressPercent,
              progressLabel: j.progressLabel,
              candidatePath: j.sourceCandidatePath ?? undefined,
            });
          }
          if (next.size > 0) setEnhanceJobs(next);
        }
        if (data.model) {
          if (data.model.status === "RUNNING") {
            const startedAt = data.model.startedAt
              ? new Date(data.model.startedAt).getTime()
              : Date.now();
            if (data.model.slaMs != null && Date.now() - startedAt > data.model.slaMs) {
              setModelJob({ kind: "error", message: t.relicCollection.generateSlaExceeded });
            } else {
              setModelJob({
                kind: "running",
                jobId: data.model.jobId,
                startedAt,
                slaMs: data.model.slaMs,
                progressPercent: data.model.progressPercent,
                progressLabel: data.model.progressLabel,
              });
            }
          } else if (data.model.status === "FAILED" || data.model.status === "CANCELLED") {
            setModelJob({
              kind: "error",
              message:
                data.model.errorMessage ?? `job ${data.model.status.toLowerCase()}`,
            });
          }
        }
      } catch {
        // network failure on restore is non-fatal — admin can manually retry.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, relicId, t]);

  // Polling driver. One tick per POLL_MS: queries each running enhance job
  // + the model job (if running). Refs hold the latest state so the effect
  // doesn't resubscribe every render.
  const enhanceJobsRef = useRef(enhanceJobs);
  const modelJobRef = useRef(modelJob);
  useEffect(() => {
    enhanceJobsRef.current = enhanceJobs;
  }, [enhanceJobs]);
  useEffect(() => {
    modelJobRef.current = modelJob;
  }, [modelJob]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    async function pollOne(jobId: string): Promise<{
      status: string;
      errorMessage?: string | null;
      slaMs?: number | null;
      startedAt?: string | null;
      progressPercent?: number | null;
      progressLabel?: string | null;
    } | null> {
      const r = await fetch(`/api/relics/${relicId}/asset-job/${jobId}`, {
        credentials: "include",
      });
      if (!r.ok) return null;
      return (await r.json()) as {
        status: string;
        errorMessage?: string | null;
        slaMs?: number | null;
        startedAt?: string | null;
        progressPercent?: number | null;
        progressLabel?: string | null;
      };
    }

    async function tick() {
      const enhanceRunning = enhanceJobsRef.current;
      const m = modelJobRef.current;

      let anyDone = false;

      // — enhance jobs — poll each in parallel
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
            anyDone = true;
            continue;
          }
          if (data.status === "FAILED" || data.status === "CANCELLED") {
            nextMap.delete(entry.jobId);
            lastError = data.errorMessage ?? `job ${data.status.toLowerCase()}`;
            anyDone = true;
            continue;
          }
          const newPercent =
            typeof data.progressPercent === "number" ? data.progressPercent : null;
          const newLabel =
            typeof data.progressLabel === "string" ? data.progressLabel : null;
          const slaMs = data.slaMs ?? entry.slaMs;
          const startedAt = data.startedAt
            ? new Date(data.startedAt).getTime()
            : entry.startedAt;
          if (slaMs != null && Date.now() - startedAt > slaMs) {
            nextMap.delete(entry.jobId);
            lastError = t.relicCollection.generateSlaExceeded;
            anyDone = true;
            continue;
          }
          const prevPct = entry.progressPercent ?? -1;
          const nextPct =
            newPercent !== null && newPercent >= prevPct ? newPercent : entry.progressPercent;
          nextMap.set(entry.jobId, {
            ...entry,
            progressPercent: nextPct ?? null,
            progressLabel: newLabel ?? entry.progressLabel,
          });
        }
        setEnhanceJobs(nextMap);
        if (lastError) setEnhanceError(lastError);
      }

      // — model job — single
      if (m.kind === "running") {
        const data = await pollOne(m.jobId);
        if (cancelled) return;
        if (data) {
          if (data.status === "SUCCESS") {
            setModelJob({ kind: "idle" });
            anyDone = true;
          } else if (data.status === "FAILED" || data.status === "CANCELLED") {
            setModelJob({
              kind: "error",
              message: data.errorMessage ?? `job ${data.status.toLowerCase()}`,
            });
          } else {
            const newPercent =
              typeof data.progressPercent === "number" ? data.progressPercent : null;
            const newLabel =
              typeof data.progressLabel === "string" ? data.progressLabel : null;
            const slaMs = data.slaMs ?? m.slaMs;
            const startedAt = data.startedAt ? new Date(data.startedAt).getTime() : m.startedAt;
            if (slaMs != null && Date.now() - startedAt > slaMs) {
              setModelJob({ kind: "error", message: t.relicCollection.generateSlaExceeded });
            } else {
              setModelJob((prev) => {
                if (prev.kind !== "running" || prev.jobId !== m.jobId) return prev;
                const prevPct = prev.progressPercent ?? -1;
                const nextPct =
                  newPercent !== null && newPercent >= prevPct ? newPercent : prev.progressPercent;
                return {
                  ...prev,
                  progressPercent: nextPct ?? null,
                  progressLabel: newLabel ?? prev.progressLabel ?? null,
                };
              });
            }
          }
        }
      }

      if (anyDone) {
        // Pull fresh server-rendered state once a job finishes so the
        // carousel picks up the new entry / chip flips to ✓.
        setTimeout(() => router.refresh(), 800);
      }
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
  }, [enhanceJobs, modelJob, relicId, router, t]);

  async function startEnhance(payload: Cutout2dBatchPayload) {
    setEnhanceError(null);
    try {
      const r = await fetch(`/api/relics/${relicId}/enhance-2d`, {
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
        jobs?: Array<{
          jobId?: string;
          status?: string;
          error?: string;
          candidatePath?: string;
        }>;
      };
      const next = new Map<string, EnhanceJobEntry>(enhanceJobs);
      let anyError: string | null = null;
      for (const job of j.jobs ?? []) {
        if (job.jobId) {
          next.set(job.jobId, {
            jobId: job.jobId,
            startedAt: Date.now(),
            slaMs: null,
            progressPercent: null,
            progressLabel: null,
            candidatePath: job.candidatePath,
          });
        } else if (job.error) {
          anyError = job.error;
        }
      }
      setEnhanceJobs(next);
      if (anyError) setEnhanceError(anyError);
    } catch (e) {
      setEnhanceError(e instanceof Error ? e.message : "request failed");
    }
  }

  async function startCreate3d(opts: Meshy3dOptions, selectedPaths: string[]) {
    setModelJob({ kind: "running", jobId: "...", startedAt: Date.now(), slaMs: null });
    try {
      // Modal returns 1-4 selected enhance paths; forward as items[]. The
      // API expands each into an image data URI and posts them to Meshy
      // /multi-image-to-3d for multi-view fusion.
      const body = {
        ...opts,
        ...(selectedPaths.length > 0
          ? { items: selectedPaths.map((p) => ({ enhancedPath: p })) }
          : {}),
      };
      const r = await fetch(`/api/relics/${relicId}/create-3d`, {
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
      setModelJob({ kind: "running", jobId: j.jobId, startedAt: Date.now(), slaMs: null });
    } catch (e) {
      setModelJob({ kind: "error", message: e instanceof Error ? e.message : "request failed" });
    }
  }

  async function deleteEnhancedItem(path: string) {
    try {
      const r = await fetch(
        `/api/relics/${relicId}/enhanced-item?path=${encodeURIComponent(path)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!r.ok) {
        console.warn("[AssetTabs] delete enhanced-item failed", await r.text());
        return;
      }
      router.refresh();
    } catch (e) {
      console.warn("[AssetTabs] delete enhanced-item threw", e);
    }
  }

  const model3dDisabled = !hasEnhanced && !hasModel;

  return (
    <div
      className="aspect-square w-full border border-primary/25 relative overflow-hidden lg:aspect-auto lg:flex-1 lg:min-h-0 lg:h-full"
      style={{
        background:
          "radial-gradient(ellipse at center, #1c2020 0%, #0c0e0e 65%, #060808 100%)",
      }}
    >
      <span className="pointer-events-none absolute top-0 left-0 w-3 h-3 border-l border-t border-primary/70 z-20" />
      <span className="pointer-events-none absolute top-0 right-0 w-3 h-3 border-r border-t border-primary/70 z-20" />
      <span className="pointer-events-none absolute bottom-0 left-0 w-3 h-3 border-l border-b border-primary/70 z-20" />
      <span className="pointer-events-none absolute bottom-0 right-0 w-3 h-3 border-r border-b border-primary/70 z-20" />

      <div className="absolute top-2 right-2 z-30 flex gap-1 bg-background/70 backdrop-blur-sm border border-primary/30 px-1 py-0.5">
        <TabBtn
          active={active === "original"}
          onClick={() => setTab("original")}
          label={t.relicCollection.tabOriginal}
        />
        <TabBtn
          active={active === "enhance2d"}
          onClick={() => setTab("enhance2d")}
          label={t.relicCollection.tab2dEnhance}
        />
        <TabBtn
          active={active === "model3d"}
          onClick={() => setTab("model3d")}
          label={t.relicCollection.tab3dModel}
          disabled={model3dDisabled}
          tooltip={model3dDisabled ? t.relicCollection.tab3dRequires2d : undefined}
        />
      </div>

      <div className="absolute inset-0 px-6 pt-[34px] pb-0 flex items-center justify-center">
        {active === "original" ? (
          originItems.length > 0 ? (
            <OriginCarousel
              relicId={relicId}
              alt={alt}
              items={originItems}
              index={Math.min(originIdx, originItems.length - 1)}
              onIndex={setOriginIdx}
              t={t}
            />
          ) : hasPrimary ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/relics/${relicId}/primary`}
              alt={alt}
              className="max-h-[80%] max-w-full object-contain"
              style={{
                maskImage:
                  "radial-gradient(ellipse at center, black 55%, transparent 98%)",
                WebkitMaskImage:
                  "radial-gradient(ellipse at center, black 55%, transparent 98%)",
              }}
            />
          ) : (
            <PlaceholderText text={t.relicCollection.noModel} />
          )
        ) : active === "enhance2d" ? (
          hasEnhanced ? (
            <EnhanceCarousel
              relicId={relicId}
              alt={alt}
              items={enhancedItems}
              index={Math.min(enhanceIdx, enhancedItems.length - 1)}
              onIndex={setEnhanceIdx}
              runningCount={enhanceRunningCount}
              t={t}
            />
          ) : (
            <GenerateBlock
              admin={isAdmin}
              running={enhanceRunningCount > 0}
              error={enhanceError}
              onStart={() => setShow2dConfig(true)}
              etaText={t.relicCollection.enhanceEta}
              startLabel={t.relicCollection.enhanceStart}
              runningLabel={t.relicCollection.enhanceRunning}
              t={t}
            />
          )
        ) : hasModel ? (
          <div className="h-[80%] aspect-square max-w-full">
            <RelicViewer modelUrl={`/api/relics/${relicId}/model`} alt={alt} t={t} />
          </div>
        ) : (
          <ModelGenerateBlock
            admin={isAdmin}
            jobState={modelJob}
            onStart={() => setShow3dConfig(true)}
            t={t}
          />
        )}
      </div>

      {show3dConfig ? (
        <Meshy3dConfigModal
          t={t}
          onCancel={() => setShow3dConfig(false)}
          onConfirm={(opts, selectedPaths) => {
            setShow3dConfig(false);
            void startCreate3d(opts, selectedPaths);
          }}
          enhancedItems={enhancedItems.map((e) => ({
            path: e.path,
            sourceCandidatePath: e.sourceCandidatePath,
            model: e.model,
            operatingResolution: e.operatingResolution,
            createdAt: e.createdAt,
          }))}
          enhancedThumbUrl={(p) =>
            `/api/relics/${relicId}/enhanced?path=${encodeURIComponent(p)}`
          }
          hasModel={hasModel}
          running={modelJob.kind === "running"}
          modelUrl={hasModel ? `/api/relics/${relicId}/model` : undefined}
          modelAlt={alt}
          onUploadGlb={async (file) => {
            const form = new FormData();
            form.append("file", file);
            const r = await fetch(`/api/relics/${relicId}/model/upload`, {
              method: "POST",
              credentials: "include",
              body: form,
            });
            if (!r.ok) {
              const j = (await r.json().catch(() => ({}))) as { error?: string };
              throw new Error(j.error ?? `HTTP ${r.status}`);
            }
            // Pull fresh server state so model3d tab + step 3 preview
            // pick up the new modelPath.
            router.refresh();
          }}
        />
      ) : null}
      {show2dConfig ? (
        <Cutout2dConfigModal
          t={t}
          relicId={relicId}
          candidates={candidatesForEnhance}
          enhancedItems={enhancedItems}
          candidateThumbUrl={(p) =>
            `/api/relics/${relicId}/candidate?path=${encodeURIComponent(p)}`
          }
          enhancedThumbUrl={(p) =>
            `/api/relics/${relicId}/enhanced?path=${encodeURIComponent(p)}`
          }
          onEnhancedDelete={deleteEnhancedItem}
          runningJobs={Array.from(enhanceJobs.values()).map((e) => ({
            jobId: e.jobId,
            candidatePath: e.candidatePath,
          }))}
          runningError={enhanceError}
          onCancel={() => setShow2dConfig(false)}
          onConfirm={(payload) => {
            // Keep the modal open during runtime — admin closes via the
            // step-3 "完成" button after reviewing results.
            void startEnhance(payload);
          }}
        />
      ) : null}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  label,
  disabled,
  tooltip,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  tooltip?: string;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={tooltip}
      aria-disabled={disabled}
      className={[
        "px-2.5 py-1 font-label text-[10px] tracking-[0.2em] uppercase transition-colors",
        disabled
          ? "text-on-surface-variant/30 cursor-not-allowed"
          : active
            ? "text-primary border-b border-primary"
            : "text-on-surface-variant hover:text-primary/80 border-b border-transparent",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function OriginCarousel({
  relicId,
  alt,
  items,
  index,
  onIndex,
  t,
}: {
  relicId: string;
  alt: string;
  items: OriginCarouselItem[];
  index: number;
  onIndex: (i: number) => void;
  t: Dictionary;
}) {
  const total = items.length;
  const current = items[index];
  const src =
    current.kind === "primary" || !current.path
      ? `/api/relics/${relicId}/primary`
      : `/api/relics/${relicId}/candidate?path=${encodeURIComponent(current.path)}`;
  const badgeLabel =
    current.kind === "primary"
      ? t.relicCollection.originBadgePrimary
      : current.kind === "network"
        ? t.relicCollection.originBadgeNetwork
        : t.relicCollection.originBadgeCandidate;
  const badgeColor =
    current.kind === "primary"
      ? "text-primary border-primary/60"
      : current.kind === "network"
        ? "text-secondary border-secondary/60"
        : "text-on-surface border-on-surface/50";
  const groupTotal = items.filter((it) => it.kind === current.kind).length;
  const groupPos = items.slice(0, index + 1).filter((it) => it.kind === current.kind).length;
  const go = (delta: number) => onIndex((index + delta + total) % total);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={src}
        src={src}
        alt={alt}
        className="max-h-[80%] max-w-full object-contain"
        style={{
          maskImage: "radial-gradient(ellipse at center, black 55%, transparent 98%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 55%, transparent 98%)",
        }}
      />
      <div
        className={
          "absolute top-2 left-2 z-30 px-2 py-1 bg-background/70 backdrop-blur-sm border " +
          "font-label text-[10px] tracking-[0.25em] uppercase flex items-center gap-2 " +
          badgeColor
        }
      >
        <span>{badgeLabel}</span>
        {groupTotal > 1 ? (
          <span className="text-on-surface-variant/80 tabular-nums">
            {groupPos} / {groupTotal}
          </span>
        ) : null}
      </div>
      {current.kind === "network" && current.sourceUrl ? (
        <a
          href={current.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-1.5 px-3 py-1.5 bg-background/70 backdrop-blur-sm border border-secondary/60 text-secondary font-label text-[10px] tracking-[0.25em] uppercase hover:bg-secondary/10"
        >
          <span className="material-symbols-outlined text-[14px]">open_in_new</span>
          {t.relicCollection.originSourceLink}
        </a>
      ) : null}
      {total > 1 ? (
        <>
          <button
            type="button"
            aria-label={t.relicCollection.originNavPrev}
            onClick={() => go(-1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-30 w-9 h-9 flex items-center justify-center bg-background/70 backdrop-blur-sm border border-primary/30 text-primary hover:bg-primary/10"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_left</span>
          </button>
          <button
            type="button"
            aria-label={t.relicCollection.originNavNext}
            onClick={() => go(1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-30 w-9 h-9 flex items-center justify-center bg-background/70 backdrop-blur-sm border border-primary/30 text-primary hover:bg-primary/10"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_right</span>
          </button>
        </>
      ) : null}
    </>
  );
}

function EnhanceCarousel({
  relicId,
  alt,
  items,
  index,
  onIndex,
  runningCount,
  t,
}: {
  relicId: string;
  alt: string;
  items: EnhancedImageItem[];
  index: number;
  onIndex: (i: number) => void;
  runningCount: number;
  t: Dictionary;
}) {
  const total = items.length;
  const current = items[index];
  const src = `/api/relics/${relicId}/enhanced?path=${encodeURIComponent(current.path)}`;
  const tooltip = `${current.model} · ${current.operatingResolution}${
    current.refineForeground ? " · refine" : ""
  }`;
  const go = (delta: number) => onIndex((index + delta + total) % total);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={src}
        src={src}
        alt={alt}
        title={tooltip}
        className="max-h-[80%] max-w-full object-contain"
      />
      <div
        className={
          "absolute top-2 left-2 z-30 px-2 py-1 bg-background/70 backdrop-blur-sm border " +
          "font-label text-[10px] tracking-[0.25em] uppercase flex items-center gap-2 " +
          "text-secondary border-secondary/60"
        }
        title={tooltip}
      >
        <span>{t.relicCollection.enhanceBadgeLabel}</span>
        {total > 1 ? (
          <span className="text-on-surface-variant/80 tabular-nums">
            {index + 1} / {total}
          </span>
        ) : null}
      </div>

      {/* In-flight indicator — small chip on the right next to the tab strip. */}
      {runningCount > 0 ? (
        <div className="absolute top-2 right-[170px] z-30 px-2 py-1 bg-background/70 backdrop-blur-sm border border-secondary/40 text-secondary font-label text-[10px] tracking-[0.25em] uppercase flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
          {t.relicCollection.enhanceRunning} · {runningCount}
        </div>
      ) : null}

      {total > 1 ? (
        <>
          <button
            type="button"
            aria-label={t.relicCollection.originNavPrev}
            onClick={() => go(-1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-30 w-9 h-9 flex items-center justify-center bg-background/70 backdrop-blur-sm border border-primary/30 text-primary hover:bg-primary/10"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_left</span>
          </button>
          <button
            type="button"
            aria-label={t.relicCollection.originNavNext}
            onClick={() => go(1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-30 w-9 h-9 flex items-center justify-center bg-background/70 backdrop-blur-sm border border-primary/30 text-primary hover:bg-primary/10"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_right</span>
          </button>
        </>
      ) : null}
    </>
  );
}

function PlaceholderText({ text }: { text: string }) {
  return (
    <span className="font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant/60">
      {text}
    </span>
  );
}

function GenerateBlock({
  admin,
  running,
  error,
  onStart,
  etaText,
  startLabel,
  runningLabel,
  t,
}: {
  admin: boolean;
  running: boolean;
  error: string | null;
  onStart: () => void;
  etaText: string;
  startLabel: string;
  runningLabel: string;
  t: Dictionary;
}) {
  return (
    <div className="text-center px-6 space-y-3 max-w-md">
      {!admin ? (
        <PlaceholderText text={t.relicCollection.noModel} />
      ) : running ? (
        <>
          <span className="absolute inset-0 bg-gradient-to-r from-transparent via-secondary/15 to-transparent animate-[scan_2.4s_linear_infinite]" />
          <p className="font-label text-[11px] tracking-[0.3em] uppercase text-secondary z-10 relative">
            {runningLabel}
          </p>
          <p className="text-[11px] text-on-surface-variant/70 z-10 relative">{etaText}</p>
        </>
      ) : error ? (
        <>
          <p className="font-label text-[11px] tracking-[0.3em] uppercase text-error">
            {t.relicCollection.generateFailed}
          </p>
          <p className="text-[11px] text-error/80 break-words">{error}</p>
          <button
            type="button"
            onClick={onStart}
            className="px-4 py-1.5 border border-secondary/60 text-secondary font-label text-[10px] tracking-[0.25em] uppercase hover:bg-secondary/10"
          >
            {t.relicCollection.generateRetry}
          </button>
        </>
      ) : (
        <>
          <p className="text-[11px] text-on-surface-variant/70">{etaText}</p>
          <button
            type="button"
            onClick={onStart}
            className="px-6 py-2 border border-secondary/60 text-secondary font-label text-[10px] tracking-[0.25em] uppercase hover:bg-secondary/10"
          >
            ▷ {startLabel}
          </button>
        </>
      )}
    </div>
  );
}

function ModelGenerateBlock({
  admin,
  jobState,
  onStart,
  t,
}: {
  admin: boolean;
  jobState: SingleJobState;
  onStart: () => void;
  t: Dictionary;
}) {
  return (
    <div className="text-center px-6 space-y-3 max-w-md">
      {!admin ? (
        <PlaceholderText text={t.relicCollection.noModel} />
      ) : jobState.kind === "running" ? (
        <>
          <span className="absolute inset-0 bg-gradient-to-r from-transparent via-secondary/15 to-transparent animate-[scan_2.4s_linear_infinite]" />
          <p className="font-label text-[11px] tracking-[0.3em] uppercase text-secondary z-10 relative">
            {t.relicCollection.create3dRunning}
            {typeof jobState.progressPercent === "number" ? (
              <span className="ml-2 tabular-nums">{jobState.progressPercent}%</span>
            ) : null}
          </p>
          {typeof jobState.progressPercent === "number" ? (
            <div className="z-10 relative mx-auto h-[2px] w-32 bg-secondary/15 overflow-hidden">
              <div
                className="h-full bg-secondary/70 transition-[width] duration-500"
                style={{ width: `${jobState.progressPercent}%` }}
              />
            </div>
          ) : null}
          <p className="text-[11px] text-on-surface-variant/70 z-10 relative">
            {jobState.progressLabel ? jobState.progressLabel : t.relicCollection.create3dEta}
          </p>
        </>
      ) : jobState.kind === "error" ? (
        <>
          <p className="font-label text-[11px] tracking-[0.3em] uppercase text-error">
            {t.relicCollection.generateFailed}
          </p>
          <p className="text-[11px] text-error/80 break-words">{jobState.message}</p>
          <button
            type="button"
            onClick={onStart}
            className="px-4 py-1.5 border border-secondary/60 text-secondary font-label text-[10px] tracking-[0.25em] uppercase hover:bg-secondary/10"
          >
            {t.relicCollection.generateRetry}
          </button>
        </>
      ) : (
        <>
          <p className="text-[11px] text-on-surface-variant/70">{t.relicCollection.create3dEta}</p>
          <button
            type="button"
            onClick={onStart}
            className="px-6 py-2 border border-secondary/60 text-secondary font-label text-[10px] tracking-[0.25em] uppercase hover:bg-secondary/10"
          >
            ▷ {t.relicCollection.create3dStart}
          </button>
        </>
      )}
    </div>
  );
}
