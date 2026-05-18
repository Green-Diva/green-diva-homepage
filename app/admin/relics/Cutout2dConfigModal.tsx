"use client";

// Dual-column 2D enhance workbench:
//   • Left top — candidate source grid (max 16, user → network order).
//     Multi-select checkboxes pick which sources to enhance in this run.
//     Sources already in the enhanced history get a small "done" badge
//     (admin can still tick them; same source re-enhanced overwrites its
//     previous entry, per runner upsert semantics).
//   • Left bottom — enhanced history grid (max 16 from Relic.enhancedImages).
//     Each tile hovers to show model / resolution / refine + sourceCandidatePath
//     basename; the ✕ button triggers DELETE /enhanced-item.
//   • Right — the 3 fal.ai BiRefNet param controls (model variant,
//     operating resolution, refine foreground). Same long explainers as
//     the pre-rewrite single-column dialog.
//
// Confirm emits a Cutout2dBatchPayload — { items, model, operatingResolution,
// refineForeground } — that the parent posts to /api/relics/[id]/enhance-2d
// (batch shape: server dispatches one AgentJob per item).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Dictionary } from "@/lib/i18n/types";

export type Cutout2dModel =
  | "General Use (Light)"
  | "General Use (Light 2K)"
  | "General Use (Heavy)"
  | "Matting"
  | "Portrait"
  | "General Use (Dynamic)";

export type Cutout2dResolution = "1024x1024" | "2048x2048" | "2304x2304";

// Source candidate the dialog can pick FROM. Caller passes the relic's
// non-deleted candidates (deduped against primary if you want — admin can
// still pick the primary's path explicitly).
export type CutoutCandidateInput = {
  path: string;
  source: "user" | "network";
  originalFilename?: string;
};

// One enhanced history entry the dialog displays in the lower grid.
// Mirrors the shape stored in Relic.enhancedImages.
export type CutoutEnhancedInput = {
  path: string;
  sourceCandidatePath: string;
  model: string;
  operatingResolution: string;
  refineForeground: boolean;
  createdAt: string;
};

export type Cutout2dBatchPayload = {
  items: Array<{ candidatePath: string }>;
  model: Cutout2dModel;
  operatingResolution: Cutout2dResolution;
  refineForeground: boolean;
};

// Per-job lightweight summary used to render the "running" status panel
// under step 1. Parent (AssetCard / AssetTabs) feeds whichever subset of
// its own job map maps to this modal session.
export type Cutout2dRunningJob = {
  jobId: string;
  candidatePath?: string;
};

type Props = {
  onConfirm: (payload: Cutout2dBatchPayload) => void;
  onCancel: () => void;
  relicId: string;
  candidates: CutoutCandidateInput[];
  enhancedItems: CutoutEnhancedInput[];
  // Returns a thumbnail URL for a candidate. For relics: typically
  //   `/api/relics/${relicId}/candidate?path=${encodeURIComponent(p)}`.
  // Draft preview passes a /api/relic-drafts/... variant.
  candidateThumbUrl: (path: string) => string;
  // Returns a thumbnail URL for an enhanced item (typically the
  // /api/relics/[id]/enhanced?path= stream).
  enhancedThumbUrl: (path: string) => string;
  // Fires DELETE /api/relics/[id]/enhanced-item?path=... in the parent
  // and refreshes the source data. Parent re-renders with smaller list.
  onEnhancedDelete: (path: string) => Promise<void>;
  // In-flight jobs from the parent's polling loop. Drives the status
  // panel under step 1 (thumb-by-thumb spinners + count). The modal
  // stays open during runtime so admin can watch progress + review the
  // populating history grid in step 3.
  runningJobs?: Cutout2dRunningJob[];
  // Last batch error (if any). Shown under step 1's status panel as a
  // muted warning line.
  runningError?: string | null;
  t: Dictionary;
};

const DEFAULT_MODEL: Cutout2dModel = "General Use (Light)";
const DEFAULT_RESOLUTION: Cutout2dResolution = "1024x1024";
const DEFAULT_REFINE = true;
const MAX_PICK = 16;
const SOURCE_SLOTS = 16;
const HISTORY_SLOTS = 16;

export default function Cutout2dConfigModal({
  onConfirm,
  onCancel,
  relicId: _relicId,
  candidates,
  enhancedItems,
  candidateThumbUrl,
  enhancedThumbUrl,
  onEnhancedDelete,
  runningJobs,
  runningError,
  t,
}: Props) {
  void _relicId;
  const [model, setModel] = useState<Cutout2dModel>(DEFAULT_MODEL);
  const [operatingResolution, setOperatingResolution] = useState<Cutout2dResolution>(
    DEFAULT_RESOLUTION,
  );
  const [refineForeground, setRefineForeground] = useState<boolean>(DEFAULT_REFINE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  // Peak running count seen since the last batch went to 0 — gives us
  // the denominator for "运行中 · X / Y" without needing a separate
  // "I just dispatched N" prop. Pattern: adjust-state-during-render
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  // so the lint rule against setState-in-effect doesn't fire.
  const [batchTotal, setBatchTotal] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  // null = no pending confirm; number = N session-new items waiting on
  // the in-modal "确认删除 / 返回" overlay. Replaces window.confirm so
  // the dialog matches the modal's cyber aesthetic.
  const [pendingCancelCount, setPendingCancelCount] = useState<number | null>(null);
  // Snapshot of enhanced paths that already existed when the modal
  // opened. Anything added later is "session-new" and the 取消 path
  // wipes it (per admin's "didn't intend to keep these" semantics).
  // Lazy-init from the first render's enhancedItems; doesn't move
  // when the prop updates mid-session.
  const initialEnhancedPathsRef = useRef<Set<string> | null>(null);
  if (initialEnhancedPathsRef.current === null) {
    initialEnhancedPathsRef.current = new Set(enhancedItems.map((e) => e.path));
  }
  const runningCount = runningJobs?.length ?? 0;
  if (runningCount > batchTotal) {
    setBatchTotal(runningCount);
  } else if (runningCount === 0 && batchTotal !== 0) {
    setBatchTotal(0);
  }
  const currentPosition = batchTotal === 0 ? 0 : batchTotal - runningCount + 1;

  // Entry from every cancel surface (footer 取消, overlay click, Esc).
  // If there are session-new enhances, route through the in-modal
  // confirm overlay (set pendingCancelCount). Empty → close directly.
  // 完成 in step 3 bypasses this — that path keeps everything.
  function handleCancel() {
    if (cancelling || pendingCancelCount !== null) return;
    const initial = initialEnhancedPathsRef.current ?? new Set<string>();
    const newPaths = enhancedItems
      .map((e) => e.path)
      .filter((p) => !initial.has(p));
    if (newPaths.length === 0) {
      onCancel();
      return;
    }
    setPendingCancelCount(newPaths.length);
  }

  // Confirmed via the in-modal overlay — actually delete the session-new
  // items, then close.
  async function performCancelDiscard() {
    const initial = initialEnhancedPathsRef.current ?? new Set<string>();
    const newPaths = enhancedItems
      .map((e) => e.path)
      .filter((p) => !initial.has(p));
    setCancelling(true);
    try {
      for (const p of newPaths) {
        await onEnhancedDelete(p);
      }
    } finally {
      setCancelling(false);
      setPendingCancelCount(null);
    }
    onCancel();
  }

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (typeof document === "undefined") return null;

  const isDynamic = model === "General Use (Dynamic)";
  const enhancedBySource = new Map(enhancedItems.map((e) => [e.sourceCandidatePath, e]));

  // Sort: user candidates first, then network — matches the layout of
  // the admin candidate gallery on the form page.
  const candidatesSorted = candidates
    .slice()
    .sort((a, b) => (a.source === b.source ? 0 : a.source === "user" ? -1 : 1))
    .slice(0, SOURCE_SLOTS);
  const enhancedSorted = enhancedItems
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, HISTORY_SLOTS);

  function handleModelChange(next: Cutout2dModel) {
    if (next !== "General Use (Dynamic)" && operatingResolution === "2304x2304") {
      setOperatingResolution("2048x2048");
    }
    setModel(next);
  }

  function toggleSelect(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        if (next.size >= MAX_PICK) return prev;
        next.add(path);
      }
      return next;
    });
  }

  async function handleDelete(path: string) {
    const ok = window.confirm(t.relicCollection.cutout2dDeleteHistoryConfirm);
    if (!ok) return;
    setDeletingPath(path);
    try {
      await onEnhancedDelete(path);
    } finally {
      setDeletingPath(null);
    }
  }

  function handleConfirm() {
    if (selected.size === 0) return;
    onConfirm({
      items: Array.from(selected).map((candidatePath) => ({ candidatePath })),
      model,
      operatingResolution,
      refineForeground,
    });
    // Clear the selection so a successful dispatch doesn't leave checks
    // sitting on candidates that have already been queued. Admin can
    // pick a fresh batch while the previous one is still running.
    setSelected(new Set());
  }

  const countLabel = t.relicCollection.cutout2dSelectedCount.replace(
    "{{n}}",
    String(selected.size),
  );

  return createPortal(
    <div
      role="dialog"
      aria-modal
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-7xl my-auto border border-secondary/40 bg-surface-container/95 shadow-[0_0_42px_rgba(233,193,118,0.18)]">
        {/* Header */}
        <div className="p-5 border-b border-primary/15">
          <h2 className="text-secondary text-xl tracking-wider">
            {t.relicCollection.cutout2dConfigTitle}
          </h2>
          <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant/75 mt-1">
            {t.relicCollection.cutout2dConfigSubtitle}
          </p>
        </div>

        {/* Body: 3 horizontal panels — sources | params | history.
            Each side panel keeps its own 4-wide thumb grid; on small
            screens the layout stacks vertically. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
          {/* — LEFT: candidate sources — */}
          <div className="border-b lg:border-b-0 lg:border-r border-primary/15 p-5 flex flex-col">
            <StepHeader index={1} title={t.relicCollection.cutout2dStep1} />
            <h3 className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mt-3 mb-2">
              {t.relicCollection.cutout2dSourceTitle}
              <span className="ml-2 text-secondary normal-case">{countLabel}</span>
            </h3>
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: SOURCE_SLOTS }).map((_, i) => {
                const c = candidatesSorted[i];
                if (!c) {
                  return (
                    <div
                      key={`src-empty-${i}`}
                      className="aspect-square border border-dashed border-primary/15 bg-background/30"
                    />
                  );
                }
                const checked = selected.has(c.path);
                const isEnhanced = enhancedBySource.has(c.path);
                return (
                  <button
                    key={c.path}
                    type="button"
                    onClick={() => toggleSelect(c.path)}
                    title={c.originalFilename || c.path}
                    className={[
                      "relative aspect-square border bg-background/50 overflow-hidden group",
                      checked
                        ? "border-secondary ring-1 ring-secondary"
                        : "border-primary/25 hover:border-secondary/60",
                    ].join(" ")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={candidateThumbUrl(c.path)}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <span
                      className={[
                        "absolute top-1 left-1 px-1 py-px font-label text-[8px] tracking-[0.2em] uppercase bg-background/80 border",
                        c.source === "network"
                          ? "text-secondary border-secondary/60"
                          : "text-on-surface border-on-surface/40",
                      ].join(" ")}
                    >
                      {c.source === "network"
                        ? t.relicCollection.originBadgeNetwork
                        : t.relicCollection.originBadgeCandidate}
                    </span>
                    {isEnhanced ? (
                      <span
                        className="absolute top-1 right-1 inline-flex items-center justify-center w-4 h-4 bg-background/80 border border-primary/40 text-primary"
                        title={t.relicCollection.cutout2dHistoryDoneBadge}
                      >
                        <span className="material-symbols-outlined text-[12px]">done</span>
                      </span>
                    ) : null}
                    {checked ? (
                      <span className="absolute inset-0 bg-secondary/20 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[28px] text-secondary drop-shadow">
                          check_circle
                        </span>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* Runtime status — single line: "运行中 · X / Y". Container
                is ALWAYS rendered (with reserved min-height) so the
                column's height doesn't pulse when a batch starts/ends.
                Keeps the whole modal at a constant size during runtime. */}
            <div className="mt-3 pt-3 border-t border-primary/15 min-h-[34px] space-y-1">
              {runningCount > 0 ? (
                <p className="flex items-center gap-1.5 font-label text-[10px] tracking-[0.25em] uppercase text-secondary">
                  <span className="material-symbols-outlined text-[14px] animate-spin">
                    progress_activity
                  </span>
                  {t.relicCollection.cutout2dRunningLabel
                    .replace("{{current}}", String(currentPosition))
                    .replace("{{total}}", String(batchTotal))}
                </p>
              ) : null}
              {runningError ? (
                <p className="text-[11px] text-error/80 break-words">
                  {t.relicCollection.cutout2dBatchError.replace("{{msg}}", runningError)}
                </p>
              ) : null}
            </div>
          </div>

          {/* — MIDDLE: params + start button — */}
          <div className="border-b lg:border-b-0 lg:border-r border-primary/15 p-5 flex flex-col gap-5">
            <StepHeader index={2} title={t.relicCollection.cutout2dStep2} />
            <Field
              label={t.relicCollection.cutout2dModel}
              hint={t.relicCollection.cutout2dModelHint}
            >
              <NativeSelect
                value={model}
                onChange={(v) => handleModelChange(v as Cutout2dModel)}
                options={[
                  { value: "General Use (Light)", label: t.relicCollection.cutout2dModelLight },
                  { value: "General Use (Light 2K)", label: t.relicCollection.cutout2dModelLight2k },
                  { value: "General Use (Heavy)", label: t.relicCollection.cutout2dModelHeavy },
                  { value: "Matting", label: t.relicCollection.cutout2dModelMatting },
                  { value: "Portrait", label: t.relicCollection.cutout2dModelPortrait },
                  { value: "General Use (Dynamic)", label: t.relicCollection.cutout2dModelDynamic },
                ]}
              />
            </Field>

            <Field
              label={t.relicCollection.cutout2dResolution}
              hint={t.relicCollection.cutout2dResolutionHint}
            >
              <NativeSelect
                value={operatingResolution}
                onChange={(v) => setOperatingResolution(v as Cutout2dResolution)}
                options={[
                  { value: "1024x1024", label: "1024 × 1024" },
                  { value: "2048x2048", label: "2048 × 2048" },
                  {
                    value: "2304x2304",
                    label: `2304 × 2304${
                      isDynamic ? "" : ` · ${t.relicCollection.cutout2dResolution2304Note}`
                    }`,
                    disabled: !isDynamic,
                  },
                ]}
              />
            </Field>

            <Toggle
              label={t.relicCollection.cutout2dRefine}
              hint={t.relicCollection.cutout2dRefineHint}
              checked={refineForeground}
              onChange={setRefineForeground}
            />
            {/* Step 2 primary action — moved out of the global footer so
                each step lives in its own column. */}
            <button
              type="button"
              onClick={handleConfirm}
              disabled={selected.size === 0}
              className="mt-auto w-full px-5 py-2.5 font-label text-[10px] tracking-[0.25em] uppercase text-background bg-secondary hover:bg-secondary/90 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {t.relicCollection.cutout2dConfirm} · {countLabel}
            </button>
          </div>

          {/* — RIGHT: enhanced history + done — */}
          <div className="p-5 flex flex-col">
            <StepHeader index={3} title={t.relicCollection.cutout2dStep3} />
            <h3 className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mt-3 mb-2">
              {t.relicCollection.cutout2dHistoryTitle}
              {enhancedItems.length > 0 ? (
                <span className="ml-2 text-on-surface-variant/70 normal-case">
                  {enhancedItems.length} / {HISTORY_SLOTS}
                </span>
              ) : null}
            </h3>
            {enhancedItems.length === 0 ? (
              <p className="text-[11px] text-on-surface-variant/60 py-3 text-center border border-dashed border-primary/15">
                {t.relicCollection.cutout2dHistoryEmpty}
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: HISTORY_SLOTS }).map((_, i) => {
                  const e = enhancedSorted[i];
                  if (!e) {
                    return (
                      <div
                        key={`hist-empty-${i}`}
                        className="aspect-square border border-dashed border-primary/15 bg-background/30"
                      />
                    );
                  }
                  const params = `${e.model} · ${e.operatingResolution}${
                    e.refineForeground ? " · refine" : ""
                  }`;
                  const srcBase = e.sourceCandidatePath.split("/").pop() ?? "";
                  return (
                    <div
                      key={e.path}
                      className="relative aspect-square border border-primary/25 bg-background/50 overflow-hidden group"
                      title={`${params}\n← ${srcBase}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={enhancedThumbUrl(e.path)}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => handleDelete(e.path)}
                        disabled={deletingPath === e.path}
                        aria-label="delete"
                        className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 bg-background/80 border border-error/50 text-error opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-40"
                      >
                        <span className="material-symbols-outlined text-[14px]">delete</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Step 3 done — closes the modal once admin has reviewed the
                history (or just acknowledged an empty pane). Sticks to
                the bottom of the column with mt-auto. */}
            <button
              type="button"
              onClick={onCancel}
              className="mt-auto w-full px-5 py-2.5 font-label text-[10px] tracking-[0.25em] uppercase text-secondary border border-secondary/60 hover:bg-secondary/10"
            >
              {t.relicCollection.cutout2dDone}
            </button>
          </div>
        </div>

        {/* Footer — only the global "abort" action; primary CTAs moved
            into their step columns. Clicking 取消 (or overlay / Esc)
            discards every enhance created in this modal session — the
            "didn't intend to keep these" branch. The step-3 ✓ 完成
            button uses onCancel directly to bypass the wipe. */}
        <div className="flex justify-end gap-3 p-4 border-t border-primary/15">
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            className="px-4 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant hover:text-on-surface disabled:opacity-40"
          >
            {t.relicCollection.cutout2dCancel}
          </button>
        </div>

        {/* In-modal cancel confirm — replaces window.confirm so the
            "你要丢弃这一批吗" prompt matches the modal's cyber styling.
            Stops propagation on the inner card so clicks don't bubble
            into the parent's onMouseDown-to-cancel handler. */}
        {pendingCancelCount !== null ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="w-full max-w-md border border-error/60 bg-surface-container/95 p-5 space-y-4 shadow-[0_0_42px_rgba(255,80,80,0.18)]">
              <p className="text-on-surface text-sm leading-relaxed">
                {t.relicCollection.cutout2dCancelConfirm.replace(
                  "{{n}}",
                  String(pendingCancelCount),
                )}
              </p>
              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setPendingCancelCount(null)}
                  disabled={cancelling}
                  className="px-4 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant hover:text-on-surface disabled:opacity-40"
                >
                  {t.relicCollection.cutout2dCancelConfirmNo}
                </button>
                <button
                  type="button"
                  onClick={() => void performCancelDiscard()}
                  disabled={cancelling}
                  className="px-5 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-background bg-error hover:bg-error/90 disabled:opacity-40"
                >
                  {cancelling ? "…" : t.relicCollection.cutout2dCancelConfirmYes}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function StepHeader({ index, title }: { index: number; title: string }) {
  return (
    <div className="flex items-center gap-2 pb-2 border-b border-primary/15">
      <span className="inline-flex items-center justify-center w-6 h-6 border border-secondary/60 text-secondary font-label text-[11px] tracking-[0.1em]">
        {String(index).padStart(2, "0")}
      </span>
      <span className="font-label text-[11px] tracking-[0.25em] uppercase text-on-surface">
        {title}
      </span>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full flex items-start gap-3 text-left p-2 hover:bg-primary/5 border border-primary/15"
    >
      <span
        aria-hidden
        className={[
          "material-symbols-outlined text-[20px] shrink-0 mt-0.5",
          checked ? "text-secondary" : "text-on-surface-variant/40",
        ].join(" ")}
      >
        {checked ? "check_circle" : "radio_button_unchecked"}
      </span>
      <span className="flex-1 min-w-0">
        <span
          className={`block font-label text-[11px] tracking-[0.22em] uppercase ${
            checked ? "text-secondary" : "text-on-surface"
          }`}
        >
          {label}
        </span>
        <span className="block text-[11px] text-on-surface-variant/70 mt-0.5">{hint}</span>
      </span>
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mb-1">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="block text-[11px] text-on-surface-variant/60 mt-1">{hint}</span>
      ) : null}
    </label>
  );
}

function NativeSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-background/60 border border-primary/30 px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
