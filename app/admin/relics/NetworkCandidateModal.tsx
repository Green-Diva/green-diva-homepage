"use client";

// Two-tab modal triggered from the "Network finds" AssetModule's empty
// slot in RelicForm. Replaces the legacy hidden file-input flow.
//
//   Tab "manual" — admin pastes (image URL) + (reference page URL).
//                  Server downloads the image (SSRF-defended) and persists
//                  it as a network candidate with sourceUrl set.
//   Tab "search" — POSTs the relic's primary image to Google Cloud Vision
//                  WEB_DETECTION via the lens-search scene; admin checks
//                  off matches and bulk-adds them through the same JSON
//                  branch of /api/relics/[id]/candidate.
//
// Both flows append to Relic.candidateImages via the parent's onAdded
// callback (RelicForm folds it into local state, then the form's submit
// handler PATCHes the relic).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";
import type { CandidateImage } from "./CandidateImageGallery";

type Tab = "manual" | "search";

type LensMatch = {
  imageUrl: string;
  sourceUrl: string;
  thumbnailUrl?: string;
  title?: string;
  score: number;
};

type Props = {
  relicId: string;
  primaryImagePath: string | null;
  open: boolean;
  onClose: () => void;
  onAdded: (added: CandidateImage[]) => void;
  // Remaining slot count in the network-candidate grid. Caps how many
  // search matches admin can select, and disables the manual save button
  // when 0. RelicForm computes this from MAX_SLOTS minus the current
  // non-deleted network candidates.
  remainingSlots: number;
};

const HIGH_THRESHOLD = 80;
const MID_THRESHOLD = 60;
const IMPORT_CONCURRENCY = 3;

export default function NetworkCandidateModal({
  relicId,
  primaryImagePath,
  open,
  onClose,
  onAdded,
  remainingSlots,
}: Props) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("manual");

  // Manual tab state — local file upload + reference page URL.
  // (Pasting a remote image URL was retired 2026-05-15: admin's expected
  // workflow is "I have this image AND I know where it came from"; the
  // server-side fetch path was removed and the JSON branch of the
  // candidate POST endpoint is now only used by the search tab's batch
  // import, where Vision API supplies the URL.)
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // Search tab state
  const [searching, setSearching] = useState(false);
  const [searchPhase, setSearchPhase] = useState<"idle" | "fetching" | "scoring">("idle");
  const [results, setResults] = useState<LensMatch[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showLow, setShowLow] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [searchError, setSearchError] = useState<string | null>(null);

  const searchDisabled = !primaryImagePath;
  const slotsFull = remainingSlots <= 0;

  // Parent gates mount on `open` (RelicForm only renders this when
  // networkModalOpen=true), so this component's local state — including
  // any transient error from a previous session — resets via unmount/
  // remount on each open. No setState-in-effect reset dance needed.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  function isValidHttpUrl(s: string): boolean {
    try {
      const u = new URL(s);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  function pickFile(f: File | null) {
    setManualError(null);
    setFile(f);
  }

  async function submitManual() {
    setManualError(null);
    if (slotsFull) {
      setManualError(t.adminRelics.netSlotsFull);
      return;
    }
    const src = sourceUrl.trim();
    if (!file || !src) {
      setManualError(t.adminRelics.netManualMissingFields);
      return;
    }
    if (!isValidHttpUrl(src)) {
      setManualError(t.adminRelics.netManualInvalidUrl);
      return;
    }
    setManualSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("source", "network");
      fd.append("sourceUrl", src);
      const res = await fetch(`/api/relics/${relicId}/candidate`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          errorMessage?: string;
          error?: string;
        };
        setManualError(j.errorMessage ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as { candidate: CandidateImage };
      onAdded([j.candidate]);
      onClose();
    } catch (e) {
      setManualError(e instanceof Error ? e.message : "save failed");
    } finally {
      setManualSubmitting(false);
    }
  }

  async function startSearch() {
    if (searchDisabled || searching) return;
    setSearchError(null);
    setResults(null);
    setSelected(new Set());
    setSearching(true);
    setSearchPhase("fetching");
    try {
      // Bump phase label after a tick — UX cue that "scoring" is happening
      // even though it's all part of one server call.
      const phaseTimer = setTimeout(() => setSearchPhase("scoring"), 4000);
      // Send the form's *current* primary (may differ from DB if admin
      // re-picked primary in the draft without saving). Server validates it
      // against the relic's candidateImages whitelist.
      const res = await fetch(`/api/relics/${relicId}/lens-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          primaryImagePath ? { primaryImagePath } : {},
        ),
      });
      clearTimeout(phaseTimer);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          errorMessage?: string;
          error?: string;
          errorCode?: string;
        };
        const msg = j.errorMessage ?? j.error ?? `HTTP ${res.status}`;
        setSearchError(
          j.errorCode === "TIMEOUT"
            ? t.adminRelics.netSearchTimeout
            : t.adminRelics.netSearchFailed.replace("{{msg}}", msg),
        );
        return;
      }
      const j = (await res.json()) as { matches: LensMatch[] };
      const sorted = [...(j.matches ?? [])].sort((a, b) => b.score - a.score);
      // Dedupe by imageUrl. Vision API's WEB_DETECTION sometimes returns
      // the same image URL across multiple `pagesWithMatchingImages`
      // entries (one CDN-hosted image, N pages citing it). Without this,
      // ResultGrid renders duplicate React keys (same imageUrl) → React
      // logs a warning and the checkbox state can desync onto the wrong
      // card. Keep the highest-scored occurrence (sorted is descending).
      const seen = new Set<string>();
      const deduped: LensMatch[] = [];
      for (const m of sorted) {
        if (seen.has(m.imageUrl)) continue;
        seen.add(m.imageUrl);
        deduped.push(m);
      }
      setResults(deduped);
      // Default-select high-similarity matches, capped at remainingSlots so
      // admin can't accidentally over-select when the grid is nearly full.
      const preselect = new Set<string>();
      for (const m of deduped) {
        if (m.score < HIGH_THRESHOLD) continue;
        if (preselect.size >= remainingSlots) break;
        preselect.add(m.imageUrl);
      }
      setSelected(preselect);
    } catch (e) {
      setSearchError(
        t.adminRelics.netSearchFailed.replace(
          "{{msg}}",
          e instanceof Error ? e.message : "unknown",
        ),
      );
    } finally {
      setSearching(false);
      setSearchPhase("idle");
    }
  }

  function toggleSelected(imageUrl: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(imageUrl)) {
        next.delete(imageUrl);
        // Removing a selection always allowed — also clears any cap-hit
        // error from a prior over-select attempt.
        setSearchError(null);
        return next;
      }
      // Adding a new selection — enforce remainingSlots cap.
      if (next.size >= remainingSlots) {
        setSearchError(
          t.adminRelics.netSlotsLimitReached.replace("{{n}}", String(remainingSlots)),
        );
        return prev;
      }
      next.add(imageUrl);
      setSearchError(null);
      return next;
    });
  }

  async function importSelected() {
    if (!results || selected.size === 0 || importing) return;
    const picks = results.filter((m) => selected.has(m.imageUrl));
    setImporting(true);
    setImportProgress({ done: 0, total: picks.length });
    const added: CandidateImage[] = [];
    let failed = 0;

    // Tiny in-line concurrency limiter — cap parallel server-side image
    // fetches at IMPORT_CONCURRENCY so we don't hammer the candidate
    // endpoint or the source CDNs.
    let cursor = 0;
    async function worker() {
      for (;;) {
        const i = cursor++;
        if (i >= picks.length) return;
        const m = picks[i];
        try {
          const res = await fetch(`/api/relics/${relicId}/candidate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source: "network",
              imageUrl: m.imageUrl,
              sourceUrl: m.sourceUrl,
            }),
          });
          if (res.ok) {
            const j = (await res.json()) as { candidate: CandidateImage };
            added.push(j.candidate);
          } else {
            failed += 1;
          }
        } catch {
          failed += 1;
        }
        setImportProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    }
    const workers = Array.from(
      { length: Math.min(IMPORT_CONCURRENCY, picks.length) },
      worker,
    );
    await Promise.all(workers);

    setImporting(false);
    if (added.length > 0) onAdded(added);
    if (failed > 0) {
      setSearchError(
        t.adminRelics.netSearchFailed.replace(
          "{{msg}}",
          `${failed}/${picks.length}`,
        ),
      );
    }
    if (added.length > 0 && failed === 0) {
      onClose();
    }
  }

  // Score-tier partitions — controls UI grouping + color badges.
  const high = (results ?? []).filter((r) => r.score >= HIGH_THRESHOLD);
  const mid = (results ?? []).filter(
    (r) => r.score >= MID_THRESHOLD && r.score < HIGH_THRESHOLD,
  );
  const low = (results ?? []).filter((r) => r.score < MID_THRESHOLD);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col border border-primary/40 bg-background/95 shadow-[0_0_40px_rgba(82,253,207,0.12)]">
        <div className="px-6 pt-5 pb-3 border-b border-primary/15">
          <h3 className="font-headline text-lg text-primary tracking-wide uppercase">
            {t.adminRelics.netModalTitle}
          </h3>
          <div className="flex gap-1 mt-3">
            <TabButton
              active={tab === "manual"}
              onClick={() => setTab("manual")}
              label={t.adminRelics.netTabManual}
            />
            <TabButton
              active={tab === "search"}
              onClick={() => setTab("search")}
              label={t.adminRelics.netTabSearch}
              disabled={searchDisabled}
              hint={searchDisabled ? t.adminRelics.netSearchPrimaryRequired : undefined}
            />
          </div>
        </div>

        {/* Slot-status banner — always visible so admin understands the cap.
            Switches to error styling when full. */}
        <div
          className={[
            "px-6 py-2 border-b font-label text-[10px] tracking-[0.2em] uppercase",
            slotsFull
              ? "border-error/40 bg-error/[0.06] text-error"
              : "border-primary/15 text-on-surface-variant",
          ].join(" ")}
        >
          {slotsFull
            ? t.adminRelics.netSlotsFull
            : t.adminRelics.netSlotsRemaining.replace("{{n}}", String(remainingSlots))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {tab === "manual" ? (
            <ManualPanel
              file={file}
              sourceUrl={sourceUrl}
              onPickFile={pickFile}
              onSourceUrlChange={setSourceUrl}
              t={t}
            />
          ) : (
            <SearchPanel
              searching={searching}
              searchPhase={searchPhase}
              results={results}
              high={high}
              mid={mid}
              low={low}
              showLow={showLow}
              setShowLow={setShowLow}
              selected={selected}
              toggleSelected={toggleSelected}
              onStart={startSearch}
              t={t}
            />
          )}
        </div>

        <div className="px-6 py-4 border-t border-primary/15 flex items-center gap-3">
          {tab === "manual" && manualError ? (
            <p
              role="alert"
              className="flex-1 min-w-0 font-label text-[11px] tracking-[0.2em] uppercase text-error truncate"
              title={manualError}
            >
              {manualError}
            </p>
          ) : tab === "search" && searchError ? (
            <p
              role="alert"
              className="flex-1 min-w-0 font-label text-[11px] tracking-[0.2em] uppercase text-error truncate"
              title={searchError}
            >
              {searchError}
            </p>
          ) : (
            <div className="flex-1" />
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={manualSubmitting || importing}
            className="shrink-0 px-4 py-2 font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant hover:text-on-surface disabled:opacity-40"
          >
            {t.adminRelics.cancel}
          </button>
          {tab === "manual" ? (
            <button
              type="button"
              onClick={submitManual}
              disabled={manualSubmitting || slotsFull}
              className="shrink-0 px-5 py-2 border border-primary/60 bg-primary/10 hover:bg-primary/20 disabled:opacity-40 font-label text-[11px] tracking-[0.2em] uppercase text-primary"
            >
              {manualSubmitting ? t.adminRelics.netManualSaving : t.adminRelics.netManualSave}
            </button>
          ) : (
            <button
              type="button"
              onClick={importSelected}
              disabled={importing || selected.size === 0 || !results || slotsFull}
              className="shrink-0 px-5 py-2 border border-primary/60 bg-primary/10 hover:bg-primary/20 disabled:opacity-40 font-label text-[11px] tracking-[0.2em] uppercase text-primary"
            >
              {importing
                ? t.adminRelics.netSearchImporting
                    .replace("{{done}}", String(importProgress.done))
                    .replace("{{total}}", String(importProgress.total))
                : t.adminRelics.netSearchImportSelected.replace(
                    "{{n}}",
                    String(selected.size),
                  )}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TabButton({
  active,
  onClick,
  label,
  disabled,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={[
        "px-4 py-2 font-label text-[11px] tracking-[0.25em] uppercase border transition-colors",
        active
          ? "border-secondary/70 bg-secondary/[0.08] text-secondary"
          : "border-primary/20 hover:border-primary/40 text-on-surface-variant hover:text-on-surface",
        disabled ? "opacity-40 cursor-not-allowed hover:border-primary/20 hover:text-on-surface-variant" : "",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function ManualPanel({
  file,
  sourceUrl,
  onPickFile,
  onSourceUrlChange,
  t,
}: {
  file: File | null;
  sourceUrl: string;
  onPickFile: (f: File | null) => void;
  onSourceUrlChange: (v: string) => void;
  t: ReturnType<typeof useT>;
}) {
  // No preview area: keeps the manual tab the same compact height as the
  // search tab's idle state (so admin doesn't see the modal jump in size
  // when switching between tabs). Filename + size below the picker is
  // enough confirmation that a file is selected.
  return (
    <div className="space-y-4">
      <Field label={t.adminRelics.netManualImageFile}>
        <div className="flex items-center gap-3">
          <label className="flex-1">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <span className="inline-flex items-center justify-center w-full px-3 py-2 border border-secondary/60 text-secondary font-label text-[11px] tracking-[0.2em] uppercase hover:bg-secondary/10 cursor-pointer">
              {file ? t.adminRelics.netManualReplaceFile : t.adminRelics.netManualChooseFile}
            </span>
          </label>
          {file ? (
            <button
              type="button"
              onClick={() => onPickFile(null)}
              aria-label={t.adminRelics.netManualClearFile}
              title={t.adminRelics.netManualClearFile}
              className="shrink-0 w-8 h-8 flex items-center justify-center text-error/70 hover:text-error border border-error/30 hover:border-error/60"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          ) : null}
        </div>
        {file ? (
          <p className="mt-1 text-[11px] text-on-surface-variant truncate">
            {file.name} · {(file.size / 1024).toFixed(1)} KB
          </p>
        ) : null}
      </Field>

      <Field label={t.adminRelics.netManualSourceUrl}>
        <input
          type="url"
          value={sourceUrl}
          onChange={(e) => onSourceUrlChange(e.target.value)}
          placeholder={t.adminRelics.netManualSourceUrlPlaceholder}
          className="w-full bg-transparent border border-primary/20 focus:border-primary/60 outline-none px-2 py-1.5 text-on-surface text-[13px]"
        />
      </Field>
    </div>
  );
}

function SearchPanel({
  searching,
  searchPhase,
  results,
  high,
  mid,
  low,
  showLow,
  setShowLow,
  selected,
  toggleSelected,
  onStart,
  t,
}: {
  searching: boolean;
  searchPhase: "idle" | "fetching" | "scoring";
  results: LensMatch[] | null;
  high: LensMatch[];
  mid: LensMatch[];
  low: LensMatch[];
  showLow: boolean;
  setShowLow: (v: boolean) => void;
  selected: Set<string>;
  toggleSelected: (imageUrl: string) => void;
  onStart: () => void;
  t: ReturnType<typeof useT>;
}) {
  if (results === null && !searching) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-4">
        <button
          type="button"
          onClick={onStart}
          className="px-6 py-2.5 border border-secondary/60 bg-secondary/10 hover:bg-secondary/20 font-label text-[11px] tracking-[0.25em] uppercase text-secondary"
        >
          {t.adminRelics.netSearchStart}
        </button>
      </div>
    );
  }

  if (searching) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3">
        <span
          className="material-symbols-outlined text-[32px] text-secondary animate-spin"
          style={{ fontVariationSettings: "'FILL' 0, 'wght' 400" }}
        >
          progress_activity
        </span>
        <p className="font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant">
          {searchPhase === "scoring"
            ? t.adminRelics.netSearchScoring
            : t.adminRelics.netSearchSearching}
        </p>
      </div>
    );
  }

  if (results && results.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-[12px] text-on-surface-variant/70 italic">
          {t.adminRelics.netSearchEmpty}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="font-label text-[10px] tracking-[0.2em] uppercase text-on-surface-variant">
        {high.length > 0
          ? t.adminRelics.netSearchHighCount.replace("{{n}}", String(high.length))
          : t.adminRelics.netSearchHighEmpty}
      </p>

      {high.length > 0 ? (
        <ResultGrid
          items={high}
          tier="high"
          selected={selected}
          toggleSelected={toggleSelected}
        />
      ) : null}

      {mid.length > 0 ? (
        <ResultGrid
          items={mid}
          tier="mid"
          selected={selected}
          toggleSelected={toggleSelected}
        />
      ) : null}

      {low.length > 0 ? (
        <details
          open={showLow}
          onToggle={(e) => setShowLow((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer font-label text-[10px] tracking-[0.2em] uppercase text-on-surface-variant/70 hover:text-on-surface-variant">
            {showLow ? t.adminRelics.netSearchHideLow : t.adminRelics.netSearchShowLow}{" "}
            ({low.length})
          </summary>
          <div className="mt-3">
            <ResultGrid
              items={low}
              tier="low"
              selected={selected}
              toggleSelected={toggleSelected}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ResultGrid({
  items,
  tier,
  selected,
  toggleSelected,
}: {
  items: LensMatch[];
  tier: "high" | "mid" | "low";
  selected: Set<string>;
  toggleSelected: (imageUrl: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map((m) => (
        <ResultCard
          key={m.imageUrl}
          match={m}
          tier={tier}
          checked={selected.has(m.imageUrl)}
          onToggle={() => toggleSelected(m.imageUrl)}
        />
      ))}
    </div>
  );
}

function ResultCard({
  match,
  tier,
  checked,
  onToggle,
}: {
  match: LensMatch;
  tier: "high" | "mid" | "low";
  checked: boolean;
  onToggle: () => void;
}) {
  const tierStyles =
    tier === "high"
      ? "border-secondary/70 bg-secondary/[0.04]"
      : tier === "mid"
        ? "border-amber-500/50 bg-amber-500/[0.04]"
        : "border-on-surface-variant/30 bg-background/40";
  const badgeStyles =
    tier === "high"
      ? "bg-secondary/90 text-background"
      : tier === "mid"
        ? "bg-amber-500/90 text-background"
        : "bg-on-surface-variant/60 text-background";
  const thumb = match.thumbnailUrl ?? match.imageUrl;
  return (
    <label
      className={[
        "relative flex flex-col gap-1.5 border p-2 cursor-pointer transition-colors",
        tierStyles,
      ].join(" ")}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="absolute top-2 left-2 z-10 accent-secondary cursor-pointer"
      />
      <span
        className={[
          "absolute top-1.5 right-1.5 z-10 px-1.5 py-0.5 font-label text-[9px] tracking-[0.15em] uppercase",
          badgeStyles,
        ].join(" ")}
      >
        {Math.round(match.score)}
      </span>
      <div className="aspect-square bg-background/60 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumb}
          alt=""
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
      </div>
      <a
        href={match.sourceUrl}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={match.title ?? match.sourceUrl}
        className="text-[10px] text-primary/70 hover:text-primary truncate"
      >
        {match.title ?? new URL(match.sourceUrl).hostname}
      </a>
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
