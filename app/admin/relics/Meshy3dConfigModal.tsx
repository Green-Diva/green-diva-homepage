"use client";

// Pre-flight config dialog for Meshy image-to-3D. Mirrors the 2D enhance
// dialog's 3-step layout when opened via the dual-column flow (with
// enhancedItems + relic context):
//   Step 1 (left)   — pick enhance source (multi-select placeholder
//                     until multi-view Meshy fusion lands; current
//                     create-3d takes the first enhance only).
//   Step 2 (middle) — Meshy params (PBR / HD / auto-size / model-type /
//                     symmetry / polycount / texture prompt) + the
//                     "▶ 开始生成" primary CTA at the bottom of the column.
//   Step 3 (right)  — 3D preview: empty / running / ready status, plus
//                     a deep link to the detail page (heavy model-viewer
//                     stays out of the admin tree). Bottom "✓ 完成"
//                     closes the dialog.
//
// Footer keeps only the global 取消 button. When the modal is opened
// without enhancedItems (e.g. a future non-relic caller), it falls back
// to the legacy single-column layout for back-compat.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import type { Dictionary } from "@/lib/i18n/types";

// RelicViewer (heavy @google/model-viewer) is lazy-loaded so the rest of
// the admin tree doesn't pay for it until step 3 actually needs it.
const RelicViewer = dynamic(
  () => import("@/app/relic-collection/[slug]/_components/RelicViewer"),
  { ssr: false },
);

export type Meshy3dOptions = {
  enablePbr: boolean;
  hdTexture: boolean;
  autoSize: boolean;
  modelType: "standard" | "lowpoly";
  symmetryMode: "auto" | "on" | "off";
  // undefined = use Meshy default (~30k); explicit number 100..300_000 overrides.
  targetPolycount?: number;
  // ≤600 chars; trimmed before send.
  texturePrompt?: string;
};

const DEFAULTS: Meshy3dOptions = {
  enablePbr: true,
  hdTexture: true,
  autoSize: true,
  modelType: "standard",
  symmetryMode: "auto",
};

// One Relic.enhancedImages entry the placeholder source panel can show.
export type Meshy3dEnhancedInput = {
  path: string;
  sourceCandidatePath: string;
  model: string;
  operatingResolution: string;
  createdAt: string;
};

type Props = {
  // Multi-image since 2026-05-20: selected 1-4 enhance paths drive
  // Meshy /multi-image-to-3d. Caller forwards them to /create-3d as
  // items[]. When `enhancedItems` is omitted (legacy single-column
  // mode), selectedPaths is just an empty array.
  onConfirm: (opts: Meshy3dOptions, selectedPaths: string[]) => void;
  onCancel: () => void;
  t: Dictionary;
  // Opt-in dual-column: pass enhancedItems + thumb url + relic context
  // to get the 3-step layout. Omit → legacy single-column dialog.
  enhancedItems?: Meshy3dEnhancedInput[];
  enhancedThumbUrl?: (path: string) => string;
  // Step 3 preview signals — only meaningful in dual-column mode.
  hasModel?: boolean;
  running?: boolean;
  // GLB URL for the live model-viewer embedded in step 3. Typically
  // `/api/relics/${relicId}/model`. When set + hasModel, step 3 renders
  // the model inline (model-viewer is dynamic-imported so the heavy
  // bundle only loads when this branch actually mounts).
  modelUrl?: string;
  // Alt text passed through to the embedded viewer for screen readers.
  modelAlt?: string;
  // Optional escape hatch: admin uploads a pre-made GLB and skips Meshy
  // entirely. Parent handles the multipart POST (so this dialog stays
  // network-agnostic) and refreshes its model state. The button hides
  // when the prop isn't passed (non-relic callers).
  onUploadGlb?: (file: File) => Promise<void>;
};

// Meshy /multi-image-to-3d accepts 1-4 images. We still render up to 16
// thumbnail tiles so admin sees the full enhance history, but the
// confirm button enforces selection ≤ MAX_SELECTED.
const SOURCE_SLOTS = 16;
const MAX_SELECTED = 4;

// Parsed metadata pulled out of the GLB's JSON chunk. All counts are
// "raw scene stats" — same shape that model-viewer / three.js would
// report after loading.
type GlbStats = {
  sizeBytes: number;
  triangles: number;
  vertices: number;
  materials: number;
  textures: number;
};

// GLB binary layout: 12-byte header (magic="glTF", version, total len)
// followed by chunks. First chunk MUST be JSON; we only need that one
// to read counts. We don't touch the binary buffer chunk at all.
async function parseGlbStats(url: string, signal: AbortSignal): Promise<GlbStats> {
  const res = await fetch(url, { credentials: "include", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const sizeBytes = buf.byteLength;
  const dv = new DataView(buf);
  // 0x46546c67 = 'glTF' little-endian. Magic mismatch → not a binary GLB.
  if (dv.getUint32(0, true) !== 0x46546c67) {
    throw new Error("not a GLB file");
  }
  const chunkLength = dv.getUint32(12, true);
  // 0x4e4f534a = 'JSON' little-endian.
  if (dv.getUint32(16, true) !== 0x4e4f534a) {
    throw new Error("first chunk is not JSON");
  }
  const jsonBytes = new Uint8Array(buf, 20, chunkLength);
  const json = JSON.parse(new TextDecoder().decode(jsonBytes)) as {
    meshes?: Array<{ primitives?: Array<{ indices?: number; attributes?: { POSITION?: number } }> }>;
    accessors?: Array<{ count?: number }>;
    materials?: unknown[];
    textures?: unknown[];
  };
  const accessors = json.accessors ?? [];
  let triangles = 0;
  let vertices = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const posIdx = prim.attributes?.POSITION;
      if (typeof posIdx === "number") {
        vertices += accessors[posIdx]?.count ?? 0;
      }
      if (typeof prim.indices === "number") {
        triangles += Math.floor((accessors[prim.indices]?.count ?? 0) / 3);
      } else if (typeof posIdx === "number") {
        // Unindexed: every 3 verts form a triangle.
        triangles += Math.floor((accessors[posIdx]?.count ?? 0) / 3);
      }
    }
  }
  return {
    sizeBytes,
    triangles,
    vertices,
    materials: (json.materials ?? []).length,
    textures: (json.textures ?? []).length,
  };
}

function useGlbStats(url: string | undefined): {
  loading: boolean;
  error: string | null;
  stats: GlbStats | null;
} {
  const [state, setState] = useState<{
    loading: boolean;
    error: string | null;
    stats: GlbStats | null;
  }>({ loading: false, error: null, stats: null });
  useEffect(() => {
    if (!url) {
      setState({ loading: false, error: null, stats: null });
      return;
    }
    const ctrl = new AbortController();
    setState({ loading: true, error: null, stats: null });
    parseGlbStats(url, ctrl.signal)
      .then((stats) => setState({ loading: false, error: null, stats }))
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setState({
          loading: false,
          error: e instanceof Error ? e.message : "parse failed",
          stats: null,
        });
      });
    return () => ctrl.abort();
  }, [url]);
  return state;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

export default function Meshy3dConfigModal({
  onConfirm,
  onCancel,
  t,
  enhancedItems,
  enhancedThumbUrl,
  hasModel,
  running,
  modelUrl,
  modelAlt,
  onUploadGlb,
}: Props) {
  const [opts, setOpts] = useState<Meshy3dOptions>(DEFAULTS);
  const [polycountText, setPolycountText] = useState("");
  // Only fetch GLB stats once there's actually a model on disk. The
  // viewer-side fetch hits the same URL and the browser caches the
  // response (private, max-age=3600 on /api/relics/[id]/model), so the
  // second fetch returns instantly without re-downloading.
  const glbUrl = useMemo(
    () => (hasModel && modelUrl ? modelUrl : undefined),
    [hasModel, modelUrl],
  );
  const glb = useGlbStats(glbUrl);

  // GLB upload escape hatch (admin already has a model). File input is
  // hidden — the visible button below opens it via ref.click().
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // "Generate via Meshy" toggle — mutex with the GLB upload path.
  //   checked  → params active, upload greyed (admin wants Meshy to build it)
  //   unchecked → params greyed, upload active (admin wants to bring their own GLB)
  // Default depends on lifecycle stage:
  //   - hasModel=false (initial creation): default checked. Most admins arrive
  //     here to generate, so prime the params; can untick to switch to direct upload.
  //   - hasModel=true (regen path): default unchecked. Admin opened the dialog
  //     to inspect existing model; toggling on declares intent to overwrite.
  const [regenOverride, setRegenOverride] = useState(!hasModel);
  const paramsLocked = !regenOverride;
  const uploadLocked = regenOverride;
  async function handleGlbPick(file: File | null) {
    if (!file || !onUploadGlb) return;
    setUploadError(null);
    setUploading(true);
    try {
      await onUploadGlb(file);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }
  // Visual-only multi-select. Pre-selects the first entry so the user sees
  // what the server will use (first enhance) without making it look like
  // selection isn't wired up.
  const [selectedSources, setSelectedSources] = useState<Set<string>>(() => {
    const first = enhancedItems?.[0]?.path;
    return first ? new Set([first]) : new Set();
  });
  const dualColumn = !!(enhancedItems && enhancedThumbUrl);
  const enhancedSorted = (enhancedItems ?? [])
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, SOURCE_SLOTS);

  function toggleSource(path: string) {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        if (next.size >= MAX_SELECTED) return prev; // cap; user must deselect first
        next.add(path);
      }
      return next;
    });
  }

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);

  if (typeof document === "undefined") return null;

  function handleConfirm() {
    const out: Meshy3dOptions = { ...opts };
    if (polycountText.trim()) {
      const n = Number(polycountText);
      if (Number.isFinite(n) && n >= 100 && n <= 300_000) {
        out.targetPolycount = Math.round(n);
      }
    }
    if (out.texturePrompt) {
      out.texturePrompt = out.texturePrompt.trim().slice(0, 600);
      if (!out.texturePrompt) delete out.texturePrompt;
    }
    // Preserve thumbnail render order — enhancedSorted is newest-first,
    // so the array matches what admin saw in the grid.
    const picked = dualColumn
      ? enhancedSorted.filter((e) => selectedSources.has(e.path)).map((e) => e.path)
      : [];
    onConfirm(out, picked);
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div
        className={
          "relative w-full my-auto border border-secondary/40 bg-surface-container/95 shadow-[0_0_42px_rgba(233,193,118,0.18)] " +
          (dualColumn ? "max-w-7xl" : "max-w-lg")
        }
      >
        <div className="px-5 py-3 border-b border-primary/15">
          <h2 className="text-secondary text-lg tracking-wider">
            {t.relicCollection.meshy3dConfigTitle}
          </h2>
          <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant/75 mt-0.5">
            {t.relicCollection.meshy3dConfigSubtitle}
          </p>
        </div>

        {dualColumn ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
            {/* — STEP 1 — pick enhance source */}
            <div className="border-b lg:border-b-0 lg:border-r border-primary/15 p-4 flex flex-col">
              <StepHeader index={1} title={t.relicCollection.meshy3dStep1} />
              <h3 className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mt-3 mb-2">
                {t.relicCollection.meshy3dSourceTitle}
              </h3>
              {enhancedSorted.length === 0 ? (
                <p className="text-[11px] text-on-surface-variant/60 py-3 text-center border border-dashed border-primary/15">
                  {t.relicCollection.cutout2dHistoryEmpty}
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: SOURCE_SLOTS }).map((_, i) => {
                    const e = enhancedSorted[i];
                    if (!e) {
                      return (
                        <div
                          key={`src-empty-${i}`}
                          className="aspect-square border border-dashed border-primary/15 bg-background/30"
                        />
                      );
                    }
                    const checked = selectedSources.has(e.path);
                    const tooltip = `${e.model} · ${e.operatingResolution}`;
                    return (
                      <button
                        key={e.path}
                        type="button"
                        onClick={() => toggleSource(e.path)}
                        title={tooltip}
                        className={[
                          "relative aspect-square border bg-background/50 overflow-hidden group",
                          checked
                            ? "border-secondary ring-1 ring-secondary"
                            : "border-primary/25 hover:border-secondary/60",
                        ].join(" ")}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={enhancedThumbUrl!(e.path)}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                        />
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
              )}
              <p className="mt-auto text-[11px] text-secondary/80 border border-secondary/30 bg-secondary/5 px-2 py-1.5">
                <span className="material-symbols-outlined text-[12px] align-middle mr-1">
                  info
                </span>
                {t.relicCollection.meshy3dSourcePlaceholder}
              </p>
            </div>

            {/* — STEP 2 — params + start CTA */}
            <div className="border-b lg:border-b-0 lg:border-r border-primary/15 p-4 flex flex-col gap-3">
              <StepHeader index={2} title={t.relicCollection.meshy3dStep2} />

              {/* Existing-model status + GLB upload escape hatch sit at
                  the top of step 2 as a 2-column row. Left tile reflects
                  whether Relic.modelPath already points at a GLB; right
                  tile is the upload-to-skip-Meshy button. A bottom
                  divider separates this preflight row from the actual
                  Meshy params below. */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRegenOverride((v) => !v)}
                  title={t.relicCollection.meshy3dRegenToggleHint}
                  className={[
                    "flex items-center gap-2 pl-1.5 pr-3 py-2 border transition-colors",
                    regenOverride
                      ? "border-secondary bg-secondary/15 text-secondary hover:bg-secondary/20"
                      : "border-secondary/40 bg-background/40 text-secondary hover:bg-secondary/5",
                  ].join(" ")}
                >
                  <span className="material-symbols-outlined text-[16px] shrink-0">
                    {regenOverride ? "check_box" : "check_box_outline_blank"}
                  </span>
                  <span className="font-label text-[10px] tracking-[0.22em] uppercase truncate">
                    {hasModel
                      ? regenOverride
                        ? t.relicCollection.meshy3dExistingOverride
                        : t.relicCollection.meshy3dExistingHas
                      : t.relicCollection.meshy3dExistingInitial}
                  </span>
                </button>
                {onUploadGlb ? (
                  <>
                    <input
                      ref={uploadInputRef}
                      type="file"
                      accept=".glb,model/gltf-binary"
                      className="hidden"
                      onChange={(e) => void handleGlbPick(e.target.files?.[0] ?? null)}
                    />
                    <button
                      type="button"
                      onClick={() => uploadInputRef.current?.click()}
                      disabled={uploading || running || uploadLocked}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 font-label text-[10px] tracking-[0.22em] uppercase text-secondary border border-secondary/60 hover:bg-secondary/10 disabled:opacity-30 disabled:cursor-not-allowed"
                      title={t.relicCollection.meshy3dUploadHint}
                    >
                      <span className="material-symbols-outlined text-[14px]">upload</span>
                      {uploading
                        ? t.relicCollection.meshy3dUploadRunning
                        : t.relicCollection.meshy3dUploadButton}
                    </button>
                  </>
                ) : (
                  <div className="border border-dashed border-primary/15" />
                )}
              </div>
              {uploadError ? (
                <p className="text-[11px] text-error/80 break-words -mt-1">
                  {t.relicCollection.meshy3dUploadFailed} · {uploadError}
                </p>
              ) : null}
              <div className="border-t border-primary/15 -mx-4" />

              {/* Param stack — greyed + non-interactive when locked (model
                  already exists and admin hasn't ticked "regen override").
                  fieldset/disabled cascades to all form controls inside;
                  the opacity class only fires the visual cue. */}
              <fieldset
                disabled={paramsLocked}
                className={[
                  "min-w-0 space-y-3 transition-opacity",
                  paramsLocked ? "opacity-40" : "",
                ].join(" ")}
              >
                <div className="space-y-3">
                  <Toggle
                    label={t.relicCollection.meshy3dEnablePbr}
                    hint={t.relicCollection.meshy3dEnablePbrHint}
                    checked={opts.enablePbr}
                    onChange={(v) => setOpts((s) => ({ ...s, enablePbr: v }))}
                  />
                  <Toggle
                    label={t.relicCollection.meshy3dHdTexture}
                    hint={t.relicCollection.meshy3dHdTextureHint}
                    checked={opts.hdTexture}
                    onChange={(v) => setOpts((s) => ({ ...s, hdTexture: v }))}
                  />
                  <Toggle
                    label={t.relicCollection.meshy3dAutoSize}
                    hint={t.relicCollection.meshy3dAutoSizeHint}
                    checked={opts.autoSize}
                    onChange={(v) => setOpts((s) => ({ ...s, autoSize: v }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label={t.relicCollection.meshy3dModelType}>
                    <NativeSelect
                      value={opts.modelType}
                      onChange={(v) =>
                        setOpts((s) => ({ ...s, modelType: v as "standard" | "lowpoly" }))
                      }
                      options={[
                        { value: "standard", label: t.relicCollection.meshy3dModelTypeStandard },
                        { value: "lowpoly", label: t.relicCollection.meshy3dModelTypeLowpoly },
                      ]}
                    />
                  </Field>
                  <Field label={t.relicCollection.meshy3dSymmetry}>
                    <NativeSelect
                      value={opts.symmetryMode}
                      onChange={(v) =>
                        setOpts((s) => ({ ...s, symmetryMode: v as "auto" | "on" | "off" }))
                      }
                      options={[
                        { value: "auto", label: t.relicCollection.meshy3dSymmetryAuto },
                        { value: "on", label: t.relicCollection.meshy3dSymmetryOn },
                        { value: "off", label: t.relicCollection.meshy3dSymmetryOff },
                      ]}
                    />
                  </Field>
                </div>
                <Field label={t.relicCollection.meshy3dPolycount}>
                  <input
                    type="number"
                    min={100}
                    max={300_000}
                    inputMode="numeric"
                    placeholder={t.relicCollection.meshy3dPolycountHint}
                    value={polycountText}
                    onChange={(e) => setPolycountText(e.target.value)}
                    className="w-full bg-background/60 border border-primary/30 px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/40 focus:outline-none focus:border-primary"
                  />
                </Field>
                <Field label={t.relicCollection.meshy3dTexturePrompt}>
                  <textarea
                    value={opts.texturePrompt ?? ""}
                    onChange={(e) => setOpts((s) => ({ ...s, texturePrompt: e.target.value }))}
                    maxLength={600}
                    rows={2}
                    placeholder={t.relicCollection.meshy3dTexturePromptHint}
                    className="w-full bg-background/60 border border-primary/30 px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/40 focus:outline-none focus:border-primary resize-y"
                  />
                </Field>
              </fieldset>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={
                  running ||
                  enhancedSorted.length === 0 ||
                  paramsLocked ||
                  selectedSources.size === 0
                }
                className="mt-auto w-full px-5 py-2.5 font-label text-[10px] tracking-[0.25em] uppercase text-background bg-secondary hover:bg-secondary/90 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {t.relicCollection.meshy3dConfirm}
              </button>
            </div>

            {/* — STEP 3 — preview / status + done */}
            <div className="p-4 flex flex-col">
              <StepHeader index={3} title={t.relicCollection.meshy3dStep3} />
              <h3 className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mt-2 mb-1.5">
                {t.relicCollection.meshy3dPreviewTitle}
              </h3>
              {/* 4:3 preview frame — shorter than aspect-square so the
                  whole step 3 column fits in viewport alongside step 2's
                  taller param stack. RelicViewer fills 100%/100% inside. */}
              <div className="relative w-full aspect-[4/3] border border-primary/15 bg-background/30 overflow-hidden flex items-center justify-center">
                {running ? (
                  <div className="text-center space-y-2 text-secondary px-4">
                    <span className="material-symbols-outlined text-[32px] animate-spin block mx-auto">
                      progress_activity
                    </span>
                    <p className="font-label text-[10px] tracking-[0.25em] uppercase">
                      {t.relicCollection.create3dRunning}
                    </p>
                    <p className="text-[11px] text-on-surface-variant/70">
                      {t.relicCollection.meshy3dPreviewRunning}
                    </p>
                  </div>
                ) : hasModel && modelUrl ? (
                  <RelicViewer
                    modelUrl={modelUrl}
                    alt={modelAlt ?? "3D model preview"}
                    t={t}
                  />
                ) : (
                  <p className="text-[11px] text-on-surface-variant/60 text-center px-4">
                    {t.relicCollection.meshy3dPreviewEmpty}
                  </p>
                )}
              </div>

              {/* Section label outside the card — matches the
                  "3D 模型预览" pattern above. Swaps title based on
                  whether a GLB is on disk (real stats) or not
                  (pre-flight params summary). */}
              <h3 className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant mt-3 mb-1.5">
                {hasModel && modelUrl
                  ? t.relicCollection.meshy3dModelStatsTitle
                  : t.relicCollection.meshy3dParamsSummary}
              </h3>
              <div className="border border-primary/15 bg-background/30 p-3 space-y-1">
                {hasModel && modelUrl ? (
                  glb.loading ? (
                    <p className="text-[11px] text-on-surface-variant/70">
                      {t.relicCollection.meshy3dModelStatsLoading}
                    </p>
                  ) : glb.error ? (
                    <p className="text-[11px] text-error/80 break-words">
                      {t.relicCollection.meshy3dModelStatsFailed} · {glb.error}
                    </p>
                  ) : glb.stats ? (
                    <>
                      <SummaryRow
                        label={t.relicCollection.meshy3dModelTriangles}
                        value={formatCount(glb.stats.triangles)}
                        mono
                      />
                      <SummaryRow
                        label={t.relicCollection.meshy3dModelVertices}
                        value={formatCount(glb.stats.vertices)}
                        mono
                      />
                      <SummaryRow
                        label={t.relicCollection.meshy3dModelMaterials}
                        value={formatCount(glb.stats.materials)}
                        mono
                      />
                      <SummaryRow
                        label={t.relicCollection.meshy3dModelTextures}
                        value={formatCount(glb.stats.textures)}
                        mono
                      />
                      <SummaryRow
                        label={t.relicCollection.meshy3dModelSize}
                        value={formatBytes(glb.stats.sizeBytes)}
                        mono
                      />
                    </>
                  ) : null
                ) : (
                  <>
                    <SummaryRow
                      label={t.relicCollection.meshy3dEnablePbr}
                      value={
                        opts.enablePbr
                          ? t.relicCollection.meshy3dParamsOn
                          : t.relicCollection.meshy3dParamsOff
                      }
                      good={opts.enablePbr}
                    />
                    <SummaryRow
                      label={t.relicCollection.meshy3dHdTexture}
                      value={
                        opts.hdTexture
                          ? t.relicCollection.meshy3dParamsOn
                          : t.relicCollection.meshy3dParamsOff
                      }
                      good={opts.hdTexture}
                    />
                    <SummaryRow
                      label={t.relicCollection.meshy3dAutoSize}
                      value={
                        opts.autoSize
                          ? t.relicCollection.meshy3dParamsOn
                          : t.relicCollection.meshy3dParamsOff
                      }
                      good={opts.autoSize}
                    />
                    <SummaryRow
                      label={t.relicCollection.meshy3dModelType}
                      value={
                        opts.modelType === "lowpoly"
                          ? t.relicCollection.meshy3dModelTypeLowpoly
                          : t.relicCollection.meshy3dModelTypeStandard
                      }
                    />
                    <SummaryRow
                      label={t.relicCollection.meshy3dSymmetry}
                      value={
                        opts.symmetryMode === "on"
                          ? t.relicCollection.meshy3dSymmetryOn
                          : opts.symmetryMode === "off"
                            ? t.relicCollection.meshy3dSymmetryOff
                            : t.relicCollection.meshy3dSymmetryAuto
                      }
                    />
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={onCancel}
                className="mt-auto w-full px-5 py-2.5 font-label text-[10px] tracking-[0.25em] uppercase text-secondary border border-secondary/60 hover:bg-secondary/10"
              >
                {t.relicCollection.meshy3dDone}
              </button>
            </div>
          </div>
        ) : (
          /* Legacy single-column path for non-relic callers. Unchanged. */
          <div className="p-5 space-y-5">
            <div className="space-y-3">
              <Toggle
                label={t.relicCollection.meshy3dEnablePbr}
                hint={t.relicCollection.meshy3dEnablePbrHint}
                checked={opts.enablePbr}
                onChange={(v) => setOpts((s) => ({ ...s, enablePbr: v }))}
              />
              <Toggle
                label={t.relicCollection.meshy3dHdTexture}
                hint={t.relicCollection.meshy3dHdTextureHint}
                checked={opts.hdTexture}
                onChange={(v) => setOpts((s) => ({ ...s, hdTexture: v }))}
              />
              <Toggle
                label={t.relicCollection.meshy3dAutoSize}
                hint={t.relicCollection.meshy3dAutoSizeHint}
                checked={opts.autoSize}
                onChange={(v) => setOpts((s) => ({ ...s, autoSize: v }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t.relicCollection.meshy3dModelType}>
                <NativeSelect
                  value={opts.modelType}
                  onChange={(v) =>
                    setOpts((s) => ({ ...s, modelType: v as "standard" | "lowpoly" }))
                  }
                  options={[
                    { value: "standard", label: t.relicCollection.meshy3dModelTypeStandard },
                    { value: "lowpoly", label: t.relicCollection.meshy3dModelTypeLowpoly },
                  ]}
                />
              </Field>
              <Field label={t.relicCollection.meshy3dSymmetry}>
                <NativeSelect
                  value={opts.symmetryMode}
                  onChange={(v) =>
                    setOpts((s) => ({ ...s, symmetryMode: v as "auto" | "on" | "off" }))
                  }
                  options={[
                    { value: "auto", label: t.relicCollection.meshy3dSymmetryAuto },
                    { value: "on", label: t.relicCollection.meshy3dSymmetryOn },
                    { value: "off", label: t.relicCollection.meshy3dSymmetryOff },
                  ]}
                />
              </Field>
            </div>
            <Field
              label={t.relicCollection.meshy3dPolycount}
              hint={t.relicCollection.meshy3dPolycountHint}
            >
              <input
                type="number"
                min={100}
                max={300_000}
                inputMode="numeric"
                placeholder="30000"
                value={polycountText}
                onChange={(e) => setPolycountText(e.target.value)}
                className="w-full bg-background/60 border border-primary/30 px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/40 focus:outline-none focus:border-primary"
              />
            </Field>
            <Field
              label={t.relicCollection.meshy3dTexturePrompt}
              hint={t.relicCollection.meshy3dTexturePromptHint}
            >
              <textarea
                value={opts.texturePrompt ?? ""}
                onChange={(e) => setOpts((s) => ({ ...s, texturePrompt: e.target.value }))}
                maxLength={600}
                rows={2}
                placeholder="weathered bronze, dark patina"
                className="w-full bg-background/60 border border-primary/30 px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/40 focus:outline-none focus:border-primary resize-y"
              />
            </Field>
            <div className="flex justify-end gap-3 pt-3 border-t border-primary/15">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant hover:text-on-surface"
              >
                {t.relicCollection.meshy3dCancel}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="px-5 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-background bg-secondary hover:bg-secondary/90"
              >
                {t.relicCollection.meshy3dConfirm}
              </button>
            </div>
          </div>
        )}

        {/* Footer for dual-column — only the global abort action; primary
            CTAs live in their step columns. Legacy single-column embeds
            its own footer above. */}
        {dualColumn ? (
          <div className="flex justify-end gap-3 px-4 py-2.5 border-t border-primary/15">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant hover:text-on-surface"
            >
              {t.relicCollection.meshy3dCancel}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function SummaryRow({
  label,
  value,
  good,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  good?: boolean;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px]">
      <span className="font-label text-[10px] tracking-[0.2em] uppercase text-on-surface-variant/80 shrink-0">
        {label}
      </span>
      <span
        className={[
          "text-on-surface text-right min-w-0",
          truncate ? "truncate" : "",
          mono ? "tabular-nums" : "",
          good === false ? "text-on-surface-variant/60" : "",
          good === true ? "text-secondary" : "",
        ].join(" ")}
        title={value}
      >
        {value}
      </span>
    </div>
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
      className="w-full flex items-start gap-2 text-left p-1.5 hover:bg-primary/5 border border-primary/15"
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
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-background/60 border border-primary/30 px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
