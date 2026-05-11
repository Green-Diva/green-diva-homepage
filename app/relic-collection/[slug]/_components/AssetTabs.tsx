"use client";

// 3-tab asset switcher rendered in the relic detail page's image area.
// Tabs: 原图 / 2D 增强 / 3D 立体
//
// - "原图" is always available (renders Relic.primaryImagePath via /primary).
// - "2D 增强" requires admin to click "生成" if Relic.enhancedImagePath is null;
//   otherwise renders the transparent PNG via /enhanced.
// - "3D 立体" is **disabled** until Relic.enhancedImagePath exists; after that,
//   admin clicks "生成" → POST /create-3d → poll /asset-job → router.refresh().
//
// Tab state via URL ?view= so back/forward feels right; default chosen by
// formKind + asset availability.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import type { Dictionary } from "@/lib/i18n/types";

// RelicViewer is a heavy import (model-viewer custom element). Lazy-load
// so the original-tab path doesn't pay for it.
const RelicViewer = dynamic(() => import("./RelicViewer"), { ssr: false });

type TabKey = "original" | "enhance2d" | "model3d";

type Props = {
  relicId: string;
  hasPrimary: boolean;
  hasEnhanced: boolean;
  hasModel: boolean;
  formKind: "TWO_D" | "THREE_D" | null;
  alt: string;
  isAdmin: boolean;
  t: Dictionary;
};

type JobState =
  | { kind: "idle" }
  | { kind: "running"; jobId: string; startedAt: number }
  | { kind: "error"; message: string };

const POLL_MS = 3000;

export default function AssetTabs({
  relicId,
  hasPrimary,
  hasEnhanced,
  hasModel,
  formKind,
  alt,
  isAdmin,
  t,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();

  // Default tab: prefer the asset matching formKind if present; else fall
  // back to whatever exists, or original.
  const defaultTab = useMemo<TabKey>(() => {
    const requested = params.get("view");
    if (requested === "enhance2d" || requested === "original" || requested === "model3d") {
      return requested;
    }
    if (formKind === "THREE_D" && hasModel) return "model3d";
    if (formKind === "TWO_D" && hasEnhanced) return "enhance2d";
    if (formKind === "THREE_D" && hasEnhanced) return "enhance2d"; // 3D wants enhanced as fallback
    return "original";
  }, [params, formKind, hasModel, hasEnhanced]);

  const [active, setActive] = useState<TabKey>(defaultTab);
  const [enhanceJob, setEnhanceJob] = useState<JobState>({ kind: "idle" });
  const [modelJob, setModelJob] = useState<JobState>({ kind: "idle" });

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

  // On mount (admin only), restore job state from the server so a refresh
  // mid-run doesn't drop back to "idle" while the runner is still going.
  // Latest job per scene is returned regardless of status:
  //   RUNNING → resume polling
  //   FAILED  → show error inline so admin can retry
  //   SUCCESS → ignored (hasEnhanced / hasModel already reflects it)
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/relics/${relicId}/active-jobs`, { credentials: "include" });
        if (!r.ok || cancelled) return;
        const data = (await r.json()) as {
          enhance: { jobId: string; status: string; errorMessage: string | null; startedAt: string | null } | null;
          model: { jobId: string; status: string; errorMessage: string | null; startedAt: string | null } | null;
        };
        const restore = (
          j: typeof data.enhance,
          setter: (s: JobState) => void,
        ) => {
          if (!j) return;
          if (j.status === "RUNNING") {
            setter({
              kind: "running",
              jobId: j.jobId,
              startedAt: j.startedAt ? new Date(j.startedAt).getTime() : Date.now(),
            });
          } else if (j.status === "FAILED" || j.status === "CANCELLED") {
            setter({ kind: "error", message: j.errorMessage ?? `job ${j.status.toLowerCase()}` });
          }
        };
        restore(data.enhance, setEnhanceJob);
        restore(data.model, setModelJob);
      } catch {
        // network failure on restore is non-fatal — admin can manually retry.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, relicId]);

  // Polling driver — one effect handles whichever job is currently running.
  // Refs hold the latest state without resubscribing the effect every render.
  const enhanceJobRef = useRef(enhanceJob);
  const modelJobRef = useRef(modelJob);
  useEffect(() => {
    enhanceJobRef.current = enhanceJob;
  }, [enhanceJob]);
  useEffect(() => {
    modelJobRef.current = modelJob;
  }, [modelJob]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    async function tick() {
      const e = enhanceJobRef.current;
      const m = modelJobRef.current;
      const running = e.kind === "running" ? e : m.kind === "running" ? m : null;
      if (!running) return;
      try {
        const r = await fetch(
          `/api/relics/${relicId}/asset-job/${running.jobId}`,
          { credentials: "include" },
        );
        if (cancelled) return;
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          const errMsg = j.error ?? `HTTP ${r.status}`;
          if (e.kind === "running" && e.jobId === running.jobId) {
            setEnhanceJob({ kind: "error", message: errMsg });
          }
          if (m.kind === "running" && m.jobId === running.jobId) {
            setModelJob({ kind: "error", message: errMsg });
          }
          return;
        }
        const data = (await r.json()) as {
          status: string;
          mode?: string | null;
          errorMessage?: string | null;
        };
        if (data.status === "SUCCESS") {
          if (e.kind === "running" && e.jobId === running.jobId) setEnhanceJob({ kind: "idle" });
          if (m.kind === "running" && m.jobId === running.jobId) setModelJob({ kind: "idle" });
          // Pull fresh server-rendered state.
          setTimeout(() => router.refresh(), 800);
          return;
        }
        if (data.status === "FAILED" || data.status === "CANCELLED") {
          const msg = data.errorMessage ?? `job ${data.status.toLowerCase()}`;
          if (e.kind === "running" && e.jobId === running.jobId) setEnhanceJob({ kind: "error", message: msg });
          if (m.kind === "running" && m.jobId === running.jobId) setModelJob({ kind: "error", message: msg });
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
  }, [enhanceJob, modelJob, relicId, router]);

  async function startEnhance() {
    setEnhanceJob({ kind: "running", jobId: "...", startedAt: Date.now() });
    try {
      const r = await fetch(`/api/relics/${relicId}/enhance-2d`, {
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
    } catch (e) {
      setEnhanceJob({ kind: "error", message: e instanceof Error ? e.message : "request failed" });
    }
  }

  async function startCreate3d() {
    setModelJob({ kind: "running", jobId: "...", startedAt: Date.now() });
    try {
      const r = await fetch(`/api/relics/${relicId}/create-3d`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setModelJob({ kind: "error", message: j.error ?? `HTTP ${r.status}` });
        return;
      }
      const j = (await r.json()) as { jobId: string };
      setModelJob({ kind: "running", jobId: j.jobId, startedAt: Date.now() });
    } catch (e) {
      setModelJob({ kind: "error", message: e instanceof Error ? e.message : "request failed" });
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
      {/* Cyber corner ornaments — echo VaultCell aesthetic. */}
      <span className="pointer-events-none absolute top-0 left-0 w-3 h-3 border-l border-t border-primary/70 z-20" />
      <span className="pointer-events-none absolute top-0 right-0 w-3 h-3 border-r border-t border-primary/70 z-20" />
      <span className="pointer-events-none absolute bottom-0 left-0 w-3 h-3 border-l border-b border-primary/70 z-20" />
      <span className="pointer-events-none absolute bottom-0 right-0 w-3 h-3 border-r border-b border-primary/70 z-20" />

      {/* Tab strip — overlays the top-right of the image area. */}
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

      {/* Tab content — symmetric padding so content (image / 3D model) is
          truly centered. Tab strip overlays absolutely on top-right and does
          not consume layout space. */}
      <div className="absolute inset-0 p-6 flex items-center justify-center">
        {active === "original" ? (
          hasPrimary ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/relics/${relicId}/primary`}
              alt={alt}
              className="w-full h-full object-contain"
              style={{
                // Soft radial mask fades the photo's edges into the spotlight
                // backdrop, visually unifying with the 2D enhanced (transparent
                // edges) and 3D (no edges) tabs — original feels embedded in
                // the gallery stage rather than pasted on top of it.
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
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/relics/${relicId}/enhanced`}
              alt={alt}
              className="w-full h-full object-contain"
            />
          ) : (
            <GenerateBlock
              admin={isAdmin}
              jobState={enhanceJob}
              onStart={startEnhance}
              etaText={t.relicCollection.enhanceEta}
              startLabel={t.relicCollection.enhanceStart}
              runningLabel={t.relicCollection.enhanceRunning}
              t={t}
            />
          )
        ) : (
          // model3d
          hasModel ? (
            <RelicViewer modelUrl={`/api/relics/${relicId}/model`} alt={alt} t={t} />
          ) : (
            <GenerateBlock
              admin={isAdmin}
              jobState={modelJob}
              onStart={startCreate3d}
              etaText={t.relicCollection.create3dEta}
              startLabel={t.relicCollection.create3dStart}
              runningLabel={t.relicCollection.create3dRunning}
              t={t}
            />
          )
        )}
      </div>
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

function PlaceholderText({ text }: { text: string }) {
  return (
    <span className="font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant/60">
      {text}
    </span>
  );
}

function GenerateBlock({
  admin,
  jobState,
  onStart,
  etaText,
  startLabel,
  runningLabel,
  t,
}: {
  admin: boolean;
  jobState: JobState;
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
      ) : jobState.kind === "running" ? (
        <>
          <span className="absolute inset-0 bg-gradient-to-r from-transparent via-secondary/15 to-transparent animate-[scan_2.4s_linear_infinite]" />
          <p className="font-label text-[11px] tracking-[0.3em] uppercase text-secondary z-10 relative">
            {runningLabel}
          </p>
          <p className="text-[11px] text-on-surface-variant/70 z-10 relative">{etaText}</p>
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
