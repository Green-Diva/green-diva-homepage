"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useT, useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { SkillRow, HandlerKind, EquipRow, AgentRow } from "../types";
import { collectEquippedBy } from "@/lib/agentControl/equippedBy";

type Props = {
  mode: "create" | "edit";
  initial?: SkillRow | null;
  // Optional — only passed by SkillLibrary so the editor can render an
  // "Equipped by" list in edit mode. Create mode doesn't need them.
  equipsByAgentId?: Record<string, EquipRow[]>;
  agents?: AgentRow[];
  onClose: () => void;
  onSaved: () => void;
};

const HANDLER_KIND_OPTIONS: HandlerKind[] = ["HTTP_API", "LLM_PROMPT", "MCP_SERVER"];
const STATUS_OPTIONS = ["ONLINE", "OFFLINE"] as const;

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const AUTH_SCHEMES = ["Bearer", "ApiKey", "Key", "Basic", "Header", "QueryParam"] as const;
const RESPONSE_TYPES = ["json", "text", "binary"] as const;
// Phase 2.1 added gemini support — surface it in the structured form.
const LLM_PROVIDERS = ["anthropic", "openai", "gemini"] as const;

const LLM_DEFAULT_AUTH_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

// — — Skill Presets (Phase 3) — — — — — — — — — — — — — — — — — — — — —
//
// "What does this skill do?" is the admin-facing concept; handlerKind is
// the storage detail. Every preset maps to a (handlerKind, defaultConfig)
// pair. Selecting a preset for a fresh skill scaffolds the config; for an
// edited skill it just shifts kind without clobbering admin's typed
// fields. The raw handlerKind dropdown still exists in Advanced mode.
type SkillPreset = {
  key: string;
  labelEn: string;
  labelZh: string;
  descEn: string;
  descZh: string;
  handlerKind: HandlerKind;
  // Only applied when admin first picks the preset on a NEW skill, OR
  // when switching from a different preset (so config doesn't end up
  // half-old / half-new). Existing same-preset edits are preserved.
  defaultConfig: Record<string, unknown>;
};

const SKILL_PRESETS: SkillPreset[] = [
  {
    key: "llm-anthropic",
    labelEn: "Call an LLM (Anthropic Claude)",
    labelZh: "调用 LLM（Anthropic Claude）",
    descEn: "System prompt + user template → text or JSON. Vision optional.",
    descZh: "system prompt + user template → 文本或 JSON。可选视觉。",
    handlerKind: "LLM_PROMPT",
    defaultConfig: { provider: "anthropic", model: "claude-opus-4-7" },
  },
  {
    key: "llm-openai",
    labelEn: "Call an LLM (OpenAI GPT)",
    labelZh: "调用 LLM（OpenAI GPT）",
    descEn: "GPT-4o / GPT-4 family. JSON mode supported.",
    descZh: "GPT-4o / GPT-4 系列。支持 JSON 模式。",
    handlerKind: "LLM_PROMPT",
    defaultConfig: { provider: "openai", model: "gpt-4o" },
  },
  {
    key: "llm-gemini",
    labelEn: "Call an LLM (Google Gemini, multimodal)",
    labelZh: "调用 LLM（Google Gemini，多模态）",
    descEn: "Vision + optional Google Search grounding. Best for research / image-heavy tasks.",
    descZh: "视觉 + 可选 Google Search grounding。调研 / 多图任务最佳。",
    handlerKind: "LLM_PROMPT",
    defaultConfig: { provider: "gemini", model: "gemini-2.5-flash" },
  },
  {
    key: "http-api",
    labelEn: "Call an external HTTP API",
    labelZh: "调用外部 HTTP API",
    descEn: "REST request with auth, body template, response shaping.",
    descZh: "REST 请求，含鉴权、body 模板、响应塑形。",
    handlerKind: "HTTP_API",
    defaultConfig: { method: "POST", responseType: "json" },
  },
  {
    key: "http-async",
    labelEn: "Async HTTP API (submit + poll + download)",
    labelZh: "异步 HTTP API（提交 + 轮询 + 下载）",
    descEn: "Submit a long-running task, poll for status, download result. Used for Meshy / fal.",
    descZh: "提交长任务，轮询状态，下载结果。Meshy / fal 等用此预设。",
    handlerKind: "HTTP_API",
    defaultConfig: {
      method: "POST",
      responseType: "json",
      polling: {
        url: "{{response.statusUrl}}",
        method: "GET",
        intervalMs: 5000,
        timeoutMs: 300000,
        successWhen: { path: "status", equals: "SUCCEEDED" },
      },
    },
  },
  {
    key: "mcp",
    labelEn: "MCP server (Phase 5+)",
    labelZh: "MCP 服务器（Phase 5+）",
    descEn: "Remote MCP-protocol agent. Placeholder; runtime support coming later.",
    descZh: "远程 MCP 协议代理。占位，运行时支持稍后。",
    handlerKind: "MCP_SERVER",
    defaultConfig: {},
  },
];

// Best-guess preset from an existing skill row. Used to initialise the
// preset selector when admin opens an existing skill in edit mode.
function derivePresetKey(
  kind: HandlerKind,
  config: Record<string, unknown> | null | undefined,
): string {
  const cfg = isObject(config) ? config : {};
  if (kind === "MCP_SERVER") return "mcp";
  if (kind === "LLM_PROMPT") {
    const provider = typeof cfg.provider === "string" ? cfg.provider : "anthropic";
    if (provider === "gemini") return "llm-gemini";
    if (provider === "openai") return "llm-openai";
    return "llm-anthropic";
  }
  // HTTP_API: distinguish async / vanilla via heuristics.
  if (isObject(cfg.polling)) return "http-async";
  return "http-api";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function jsonOrNull(s: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = s.trim();
  if (!trimmed) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "invalid JSON" };
  }
}

function blank(initial?: SkillRow | null) {
  return {
    slug: initial?.slug ?? "",
    level: String(initial?.level ?? 1),
    icon: initial?.icon ?? "",
    nameEn: initial?.nameEn ?? "",
    nameZh: initial?.nameZh ?? "",
    status: (initial?.status ?? "OFFLINE") as "ONLINE" | "OFFLINE",
    descriptionEn: initial?.descriptionEn ?? "",
    descriptionZh: initial?.descriptionZh ?? "",
    handlerKind: (initial?.kind ?? "MCP_SERVER") as HandlerKind,
    inputSchema: initial?.inputSchema ? JSON.stringify(initial.inputSchema, null, 2) : "",
    outputSchema: initial?.outputSchema ? JSON.stringify(initial.outputSchema, null, 2) : "",
  };
}

const SCHEMA_TEMPLATE = JSON.stringify(
  {
    type: "object",
    required: ["prompt"],
    properties: {
      prompt: { type: "string" },
    },
  },
  null,
  2,
);

// Pull a string value from a config object, defaulting to "" so it slots
// straight into a controlled <input>.
function s(cfg: Record<string, unknown>, key: string): string {
  const v = cfg[key];
  return typeof v === "string" ? v : "";
}
function n(cfg: Record<string, unknown>, key: string): string {
  const v = cfg[key];
  return typeof v === "number" ? String(v) : "";
}
function pretty(v: unknown): string {
  if (v === undefined || v === null) return "";
  return JSON.stringify(v, null, 2);
}

export default function SkillEditor({
  mode,
  initial,
  equipsByAgentId,
  agents,
  onClose,
  onSaved,
}: Props) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const [v, setV] = useState(() => blank(initial));
  // Preset key drives the visible "What this skill does" selector. Derive
  // from the existing skill on first render; subsequent edits via the
  // selector (or via the Advanced raw kind dropdown) keep this in sync.
  const [presetKey, setPresetKey] = useState<string>(() =>
    derivePresetKey(
      (initial?.kind ?? "MCP_SERVER") as HandlerKind,
      initial?.handlerConfig ?? null,
    ),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Two-page layout so the editor fits a viewport without scrolling.
  // Page 1 = identity + schemas, Page 2 = handler runtime config.
  const [page, setPage] = useState<1 | 2>(1);

  // handlerConfig is stored as a single source-of-truth Record. Structured
  // fields and the "Advanced (raw JSON)" textarea both edit the same object;
  // toggling between them serializes / parses on demand.
  const [config, setConfig] = useState<Record<string, unknown>>(
    isObject(initial?.handlerConfig) ? (initial!.handlerConfig as Record<string, unknown>) : {},
  );
  const [advanced, setAdvanced] = useState(false);
  const [advDraft, setAdvDraft] = useState("");

  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, busy]);

  const portal = useMemo(() => (typeof document !== "undefined" ? document.body : null), []);

  // Aggregate which agents currently equip this skill. Edit-mode only —
  // create mode has no id to match against. Keeps the agent.mode for
  // accent coloring (MECHANICAL gold vs AUTONOMOUS teal).
  const equippedBy =
    mode === "edit" ? collectEquippedBy(initial?.id, equipsByAgentId, agents) : [];

  if (!portal) return null;

  function upd<K extends keyof typeof v>(key: K, val: (typeof v)[K]) {
    setV((s) => ({ ...s, [key]: val }));
  }

  function setCfgField(key: string, value: unknown) {
    setConfig((c) => {
      const next = { ...c };
      // Empty string / undefined / NaN drops the key entirely so we don't
      // emit garbage like {"systemPrompt": ""} into handlerConfig.
      if (value === "" || value === undefined || (typeof value === "number" && Number.isNaN(value))) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }

  function setCfgJsonField(key: string, jsonStr: string) {
    if (!jsonStr.trim()) {
      setCfgField(key, undefined);
      return;
    }
    const parsed = jsonOrNull(jsonStr);
    if (parsed.ok) setCfgField(key, parsed.value);
    // If invalid we still update local input via separate state below; keep
    // config intact so we don't lose previous valid value.
  }

  function toggleAdvanced() {
    if (!advanced) {
      setAdvDraft(JSON.stringify(config, null, 2));
      setAdvanced(true);
    } else {
      const parsed = jsonOrNull(advDraft);
      if (!parsed.ok) {
        setErr(`Advanced JSON: ${parsed.error}`);
        return;
      }
      if (parsed.value !== null && !isObject(parsed.value)) {
        setErr("Advanced JSON must be an object");
        return;
      }
      setConfig((parsed.value as Record<string, unknown>) ?? {});
      setErr(null);
      setAdvanced(false);
    }
  }

  // When admin switches handlerKind, clear config of fields that no longer
  // apply. Keep admin-edited "_notes" / unknown keys so advanced state isn't
  // accidentally wiped.
  function onHandlerKindChange(next: HandlerKind) {
    setV((s) => ({ ...s, handlerKind: next }));
    // Wipe known kind-specific keys so the form starts clean. Other keys
    // (custom user additions) survive.
    const stripKeys = new Set([
      // HTTP_API
      "handler", "method", "url", "authEnv", "authScheme", "authHeader",
      "authQueryParam", "headers", "bodyTemplate", "queryTemplate",
      "responseType", "binaryMaxBytes", "timeoutMs",
      "polling", "download", "responseTransform",
      // LLM_PROMPT
      "provider", "model", "systemPrompt", "userTemplate", "maxTokens",
      "temperature", "responseFormat", "imagePathsField", "grounding",
      // MCP_SERVER
      "serverUrl", "toolName",
    ]);
    setConfig((c) => {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(c)) {
        if (!stripKeys.has(k)) out[k] = val;
      }
      return out;
    });
  }

  // Preset switch: scaffolds defaults on top of the current config.
  // - If admin is creating a new skill OR moving to a different handlerKind,
  //   we scaffold with preset.defaultConfig (admin-edited keys take
  //   precedence — only blank/missing keys are filled).
  // - If admin is staying within the same handlerKind (e.g. switching from
  //   "Async HTTP API" to "Save asset to relic storage" — both HTTP_API),
  //   we MERGE preset defaults so they overwrite top-level keys but
  //   admin-edited custom keys (e.g. notes) survive.
  function onPresetChange(nextKey: string) {
    const preset = SKILL_PRESETS.find((p) => p.key === nextKey);
    if (!preset) return;
    setPresetKey(nextKey);
    const wasSameKind = v.handlerKind === preset.handlerKind;
    setV((s) => ({ ...s, handlerKind: preset.handlerKind }));
    setConfig((c) => {
      // Switching kind → start over with the preset defaults; existing
      // config was for a different runtime entirely.
      if (!wasSameKind) return { ...preset.defaultConfig };
      // Same kind → overlay preset defaults so the new preset's idea of
      // "what defaults look like" wins, but admin's notes and other
      // unrecognized keys are preserved.
      return { ...c, ...preset.defaultConfig };
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);

    let finalConfig: Record<string, unknown> = config;
    if (advanced) {
      const parsed = jsonOrNull(advDraft);
      if (!parsed.ok) {
        setErr(`Advanced JSON: ${parsed.error}`);
        setPage(2);
        setBusy(false);
        return;
      }
      if (parsed.value !== null && !isObject(parsed.value)) {
        setErr("Advanced JSON must be an object");
        setPage(2);
        setBusy(false);
        return;
      }
      finalConfig = (parsed.value as Record<string, unknown>) ?? {};
    }

    const inSchema = jsonOrNull(v.inputSchema);
    if (!inSchema.ok) {
      setErr(`inputSchema: ${inSchema.error}`);
      setPage(1);
      setBusy(false);
      return;
    }
    const outSchema = jsonOrNull(v.outputSchema);
    if (!outSchema.ok) {
      setErr(`outputSchema: ${outSchema.error}`);
      setPage(1);
      setBusy(false);
      return;
    }

    const slugTrimmed = v.slug.trim();
    const body: Record<string, unknown> = {
      level: Number(v.level),
      icon: v.icon.trim(),
      nameEn: v.nameEn.trim(),
      nameZh: v.nameZh.trim(),
      status: v.status,
      descriptionEn: v.descriptionEn.trim(),
      descriptionZh: v.descriptionZh.trim(),
      kind: v.handlerKind,
      handlerConfig: finalConfig,
      inputSchema: inSchema.value,
      outputSchema: outSchema.value,
    };
    if (slugTrimmed) body.slug = slugTrimmed;

    const url = mode === "create" ? "/api/skills" : `/api/skills/${initial?.id}`;
    const method = mode === "create" ? "POST" : "PATCH";
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(typeof j.error === "string" ? j.error : t.agentControl.skillSaveFailed);
      return;
    }
    router.refresh();
    onSaved();
    onClose();
  }

  async function onDelete() {
    if (!initial) return;
    if (!confirm(format(t.agentControl.skillDeleteConfirm, { name: initial.nameZh || initial.nameEn }))) return;
    const r = await fetch(`/api/skills/${initial.id}`, { method: "DELETE" });
    if (!r.ok) {
      alert(t.agentControl.skillDeleteFailed);
      return;
    }
    router.refresh();
    onSaved();
    onClose();
  }

  const inputCls =
    "w-full bg-surface-variant/30 border border-primary/20 rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary/60 focus:bg-surface-variant/50 transition-colors";
  const codeCls = inputCls + " font-mono text-[11px] resize-y";
  const labelCls = "font-label text-[10px] tracking-[0.25em] text-primary/70 uppercase mb-1 block";
  const sectionCls = "border-t border-primary/15 pt-4";
  const sectionTitleCls = "font-label text-[11px] tracking-[0.3em] text-secondary/80 uppercase mb-3";
  const helpCls = "font-label text-[9px] tracking-[0.15em] text-on-surface-variant/60 mt-1";

  const tabBtnCls = (active: boolean) =>
    [
      "font-label text-[10px] tracking-[0.25em] uppercase px-4 py-3 border-b-2 transition-colors flex-1 text-center min-h-[44px]",
      active
        ? "border-primary text-primary"
        : "border-transparent text-on-surface-variant/60 hover:text-on-surface",
    ].join(" ");

  const page1Title = locale === "zh" ? "基础信息" : "Identity";
  const page2Title = locale === "zh" ? "运行时" : "Runtime";
  const prevLabel = locale === "zh" ? "← 上一页" : "← Prev";
  const nextLabel = locale === "zh" ? "下一页 →" : "Next →";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === "create" ? t.agentControl.skillCreateNew : t.agentControl.skillEdit}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Fixed height + width: the modal stays the same size when admin
          toggles between Page 1 / Page 2 so the layout doesn't jump.
          Body has overflow-y-auto so heavy Page 2 configs scroll
          internally rather than resizing the shell. */}
      <div className="relative w-full max-w-3xl h-[min(760px,calc(100vh-2rem))] flex flex-col">
        <div className="cyber-panel rounded-lg flex flex-col overflow-hidden flex-1 min-h-0">
          {/* ── Header ─────────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-3">
            <h2 className="font-label text-[11px] tracking-[0.3em] text-primary uppercase">
              {mode === "create" ? t.agentControl.skillCreateNew : t.agentControl.skillEdit}
            </h2>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
              aria-label="close"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {/* ── Tabs ───────────────────────────────────────────────── */}
          <div className="flex border-b border-primary/15 px-6">
            <button type="button" onClick={() => setPage(1)} className={tabBtnCls(page === 1)}>
              <span className="opacity-50 mr-1">1.</span> {page1Title}
            </button>
            <button type="button" onClick={() => setPage(2)} className={tabBtnCls(page === 2)}>
              <span className="opacity-50 mr-1">2.</span> {page2Title}
            </button>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col flex-1 min-h-0">
            {/* Body — internal scroll only as a safety net; each page
                aims to fit without scrolling. */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
              {page === 1 && (
                <div className="flex flex-col gap-4">
                  {/* Identity row */}
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className={labelCls}>Level</label>
                      <select
                        value={v.level}
                        onChange={(e) => upd("level", e.target.value)}
                        className={inputCls}
                        required
                      >
                        {[1, 2, 3, 4, 5, 6].map((n) => (
                          <option key={n} value={n}>
                            LV.{n}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className={labelCls}>Status</label>
                      <select
                        value={v.status}
                        onChange={(e) => upd("status", e.target.value as "ONLINE" | "OFFLINE")}
                        className={inputCls}
                        required
                      >
                        {STATUS_OPTIONS.map((sv) => (
                          <option key={sv} value={sv}>
                            {sv}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Slug (machine ID)</label>
                      <input
                        type="text"
                        value={v.slug}
                        onChange={(e) => upd("slug", e.target.value)}
                        className={inputCls + " font-mono text-[12px]"}
                        placeholder={mode === "create" ? "(auto-derived)" : ""}
                        pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Icon (Material Symbol)</label>
                      <input
                        type="text"
                        value={v.icon}
                        onChange={(e) => upd("icon", e.target.value)}
                        className={inputCls}
                        placeholder="psychology"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Name EN</label>
                      <input
                        type="text"
                        value={v.nameEn}
                        onChange={(e) => upd("nameEn", e.target.value)}
                        className={inputCls}
                        required
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Name ZH</label>
                      <input
                        type="text"
                        value={v.nameZh}
                        onChange={(e) => upd("nameZh", e.target.value)}
                        className={inputCls}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Description EN</label>
                      <textarea
                        rows={2}
                        value={v.descriptionEn}
                        onChange={(e) => upd("descriptionEn", e.target.value)}
                        className={inputCls + " resize-none"}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Description ZH</label>
                      <textarea
                        rows={2}
                        value={v.descriptionZh}
                        onChange={(e) => upd("descriptionZh", e.target.value)}
                        className={inputCls + " resize-none"}
                      />
                    </div>
                  </div>

                  {/* IO Contracts — side by side to save vertical space */}
                  <div className={sectionCls}>
                    <h3 className={sectionTitleCls}>IO Contracts</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>Input Schema (JSON, optional)</label>
                        <textarea
                          rows={6}
                          value={v.inputSchema}
                          onChange={(e) => upd("inputSchema", e.target.value)}
                          className={codeCls}
                          placeholder={SCHEMA_TEMPLATE}
                          spellCheck={false}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Output Schema (JSON, optional)</label>
                        <textarea
                          rows={6}
                          value={v.outputSchema}
                          onChange={(e) => upd("outputSchema", e.target.value)}
                          className={codeCls}
                          placeholder={SCHEMA_TEMPLATE}
                          spellCheck={false}
                        />
                      </div>
                    </div>
                  </div>

                  {mode === "edit" && initial?.id && (
                    <div className={sectionCls}>
                      <h3 className={sectionTitleCls}>{t.agentControl.skillEquippedBy}</h3>
                      {equippedBy.length === 0 ? (
                        <p className="text-on-surface-variant/70 text-[12px]">
                          {t.agentControl.skillEquippedByEmpty}
                        </p>
                      ) : (
                        <ul className="flex flex-wrap gap-2">
                          {equippedBy.map(({ agent, slotIndex }) => {
                            const isMech = agent.mode === "MECHANICAL";
                            const accentBorder = isMech ? "border-secondary/40" : "border-primary/40";
                            const accentText = isMech ? "text-secondary" : "text-primary";
                            const codename =
                              locale === "zh" && agent.codenameZh ? agent.codenameZh : agent.codename;
                            const slotLabel =
                              slotIndex === null
                                ? t.agentControl.skillEquippedUnslotted
                                : format(t.agentControl.skillEquippedSlotLabel, { n: slotIndex + 1 });
                            return (
                              <li
                                key={agent.id}
                                className={[
                                  "flex items-center gap-2 border rounded-sm pl-1.5 pr-2.5 py-1",
                                  "bg-surface-variant/20",
                                  accentBorder,
                                ].join(" ")}
                                title={`${agent.codename} · ${slotLabel}`}
                              >
                                {agent.avatarUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={agent.avatarUrl}
                                    alt=""
                                    className="w-6 h-8 object-cover rounded-sm border border-on-surface-variant/20"
                                    loading="lazy"
                                  />
                                ) : (
                                  <span
                                    aria-hidden
                                    className="w-6 h-8 rounded-sm border border-on-surface-variant/20 bg-surface-variant/40"
                                  />
                                )}
                                <span className="flex flex-col leading-tight">
                                  <span
                                    className={[
                                      "font-label text-[10px] tracking-[0.15em] uppercase",
                                      accentText,
                                    ].join(" ")}
                                  >
                                    {codename}
                                  </span>
                                  <span className="font-label text-[9px] tracking-[0.1em] uppercase text-on-surface-variant/60">
                                    {slotLabel}
                                  </span>
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}

              {page === 2 && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className={sectionTitleCls + " mb-0"}>Runtime — Handler</h3>
                    <button
                      type="button"
                      onClick={toggleAdvanced}
                      className="font-label text-[9px] tracking-[0.2em] uppercase text-on-surface-variant/70 hover:text-primary transition-colors flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {advanced ? "view_list" : "code"}
                      </span>
                      {advanced ? "Form view" : "Advanced (raw JSON)"}
                    </button>
                  </div>

                  <div>
                    <label className={labelCls}>What this skill does</label>
                    <select
                      value={presetKey}
                      onChange={(e) => onPresetChange(e.target.value)}
                      className={inputCls}
                      required
                    >
                      {SKILL_PRESETS.map((p) => (
                        <option key={p.key} value={p.key}>
                          {locale === "zh" ? p.labelZh : p.labelEn}
                        </option>
                      ))}
                    </select>
                    <p className={helpCls}>
                      {(() => {
                        const p = SKILL_PRESETS.find((x) => x.key === presetKey);
                        if (!p) return null;
                        return locale === "zh" ? p.descZh : p.descEn;
                      })()}
                    </p>
                    {advanced ? (
                      <div className="mt-3 border-t border-primary/10 pt-3">
                        <label className={labelCls}>Handler Kind (raw)</label>
                        <select
                          value={v.handlerKind}
                          onChange={(e) => onHandlerKindChange(e.target.value as HandlerKind)}
                          className={inputCls + " font-mono text-[12px]"}
                        >
                          {HANDLER_KIND_OPTIONS.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                        <p className={helpCls}>
                          Storage detail. Most admins should use the preset above instead.
                        </p>
                      </div>
                    ) : null}
                  </div>

                  {advanced ? (
                    <div>
                      <label className={labelCls}>Handler Config (raw JSON)</label>
                      <textarea
                        rows={12}
                        value={advDraft}
                        onChange={(e) => setAdvDraft(e.target.value)}
                        className={codeCls}
                        spellCheck={false}
                      />
                      <p className={helpCls}>
                        Escape hatch for unusual configs. Keys named{" "}
                        <code>apiKey</code>/<code>secret</code>/<code>token</code>/<code>password</code>{" "}
                        are rejected — use <code>authEnv</code> instead.
                      </p>
                    </div>
                  ) : (
                    <StructuredHandlerFields
                      kind={v.handlerKind}
                      config={config}
                      setField={setCfgField}
                      setJsonField={setCfgJsonField}
                      inputCls={inputCls}
                      codeCls={codeCls}
                      labelCls={labelCls}
                      helpCls={helpCls}
                    />
                  )}
                </div>
              )}
            </div>

            {/* ── Footer ──────────────────────────────────────────── */}
            <div className="border-t border-primary/15 px-6 py-3 flex flex-col gap-2">
              {err && <p className="text-error text-sm">{err}</p>}
              <div className="flex items-center justify-between gap-3">
                {mode === "edit" ? (
                  <button
                    type="button"
                    onClick={onDelete}
                    disabled={busy}
                    className="font-label text-[10px] tracking-[0.2em] uppercase text-error/70 hover:text-error transition-colors min-h-[44px] px-3"
                  >
                    {t.agentControl.remove}
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-3 items-center">
                  {page === 2 && (
                    <button
                      type="button"
                      onClick={() => setPage(1)}
                      disabled={busy}
                      className="font-label text-[10px] tracking-[0.2em] uppercase text-on-surface-variant hover:text-on-surface transition-colors min-h-[44px] px-3"
                    >
                      {prevLabel}
                    </button>
                  )}
                  {page === 1 && (
                    <button
                      type="button"
                      onClick={() => setPage(2)}
                      disabled={busy}
                      className="font-label text-[10px] tracking-[0.2em] uppercase text-primary hover:text-primary/80 transition-colors min-h-[44px] px-3"
                    >
                      {nextLabel}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={busy}
                    className="font-label text-[10px] tracking-[0.2em] uppercase text-on-surface-variant hover:text-on-surface transition-colors min-h-[44px] px-4"
                  >
                    {t.agentControl.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="cyber-btn font-label text-[10px] tracking-[0.2em] uppercase min-h-[44px] px-6"
                  >
                    {busy ? t.agentControl.saving : t.agentControl.save}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>,
    portal,
  );
}

// Nested-object helper: read a subkey from a Record-valued field, default {}.
function obj(config: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = config[key];
  return isObject(v) ? v : {};
}

// Mutate a single nested key inside config[parent], dropping the whole
// parent block when it becomes empty so we don't emit {polling: {}}.
function setNested(
  setField: (key: string, value: unknown) => void,
  parent: Record<string, unknown>,
  parentKey: string,
  childKey: string,
  childValue: unknown,
) {
  const drop =
    childValue === "" ||
    childValue === undefined ||
    (typeof childValue === "number" && Number.isNaN(childValue));
  const next: Record<string, unknown> = { ...parent };
  if (drop) delete next[childKey];
  else next[childKey] = childValue;
  if (Object.keys(next).length === 0) setField(parentKey, undefined);
  else setField(parentKey, next);
}

// Structured handler config form — one section per HandlerKind. Anything
// not covered here lives in the "Advanced (raw JSON)" view.
function StructuredHandlerFields({
  kind,
  config,
  setField,
  setJsonField,
  inputCls,
  codeCls,
  labelCls,
  helpCls,
}: {
  kind: HandlerKind;
  config: Record<string, unknown>;
  setField: (key: string, value: unknown) => void;
  setJsonField: (key: string, jsonStr: string) => void;
  inputCls: string;
  codeCls: string;
  labelCls: string;
  helpCls: string;
}) {
  if (kind === "HTTP_API") {
    const method = s(config, "method") || "POST";
    const bodyAllowed = method !== "GET" && method !== "HEAD";
    const authScheme = s(config, "authScheme") || "Bearer";
    const responseType = s(config, "responseType") || "json";
    const polling = obj(config, "polling");
    const download = obj(config, "download");
    const hasAsync = config.polling !== undefined || config.download !== undefined;
    // Backend rejects polling + binary combo (httpApi.ts:537). Hide the
    // polling block entirely under binary so admin can't configure an
    // invalid combo.
    const pollingAllowed = responseType !== "binary";
    const setPolling = (k: string, val: unknown) =>
      setNested(setField, polling, "polling", k, val);
    const setDownload = (k: string, val: unknown) =>
      setNested(setField, download, "download", k, val);

    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[120px_1fr] gap-3">
          <div>
            <label className={labelCls}>Method</label>
            <select
              value={method}
              onChange={(e) => setField("method", e.target.value)}
              className={inputCls}
            >
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Endpoint URL</label>
            <input
              type="text"
              value={s(config, "url")}
              onChange={(e) => setField("url", e.target.value)}
              className={inputCls + " font-mono text-[12px]"}
              placeholder="https://api.example.com/v1/endpoint"
              required
            />
          </div>
        </div>

        {/* Auth ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Auth Env Name</label>
            <input
              type="text"
              value={s(config, "authEnv")}
              onChange={(e) => setField("authEnv", e.target.value)}
              className={inputCls + " font-mono text-[12px]"}
              placeholder="EXAMPLE_API_KEY"
            />
            <p className={helpCls}>Server-side env name only. Never paste the key here.</p>
          </div>
          <div>
            <label className={labelCls}>Auth Scheme</label>
            <select
              value={authScheme}
              onChange={(e) =>
                setField("authScheme", e.target.value === "Bearer" ? undefined : e.target.value)
              }
              className={inputCls}
            >
              {AUTH_SCHEMES.map((sch) => (
                <option key={sch} value={sch}>
                  {sch}
                </option>
              ))}
            </select>
            <p className={helpCls}>
              Bearer (default) / ApiKey / Key (fal.ai) / Basic / Header (custom) / QueryParam (SerpAPI, GCP Vision).
            </p>
          </div>
        </div>
        {authScheme === "Header" && (
          <div>
            <label className={labelCls}>Auth Header Name</label>
            <input
              type="text"
              value={s(config, "authHeader")}
              onChange={(e) => setField("authHeader", e.target.value)}
              className={inputCls + " font-mono text-[12px]"}
              placeholder="X-API-Key"
            />
          </div>
        )}
        {authScheme === "QueryParam" && (
          <div>
            <label className={labelCls}>Auth Query Param Name</label>
            <input
              type="text"
              value={s(config, "authQueryParam")}
              onChange={(e) => setField("authQueryParam", e.target.value)}
              className={inputCls + " font-mono text-[12px]"}
              placeholder="api_key"
            />
            <p className={helpCls}>Env value appended as ?{s(config, "authQueryParam") || "api_key"}=...</p>
          </div>
        )}

        {/* Response shape ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Response Type</label>
            <select
              value={responseType}
              onChange={(e) =>
                setField("responseType", e.target.value === "json" ? undefined : e.target.value)
              }
              className={inputCls}
            >
              {RESPONSE_TYPES.map((rt) => (
                <option key={rt} value={rt}>
                  {rt}
                </option>
              ))}
            </select>
            <p className={helpCls}>
              binary → {`{ base64, contentType, bytes, url }`}. Incompatible with polling.
            </p>
          </div>
          <div>
            <label className={labelCls}>Timeout (ms)</label>
            <input
              type="number"
              min={1000}
              max={600000}
              value={n(config, "timeoutMs")}
              onChange={(e) =>
                setField("timeoutMs", e.target.value === "" ? undefined : Number(e.target.value))
              }
              className={inputCls}
              placeholder="30000"
            />
          </div>
        </div>
        {responseType === "binary" && (
          <div>
            <label className={labelCls}>Binary Max Bytes</label>
            <input
              type="number"
              min={1024}
              value={n(config, "binaryMaxBytes")}
              onChange={(e) =>
                setField("binaryMaxBytes", e.target.value === "" ? undefined : Number(e.target.value))
              }
              className={inputCls}
              placeholder="52428800 (50 MB)"
            />
          </div>
        )}

        {/* Templates ──────────────────────────────────────────────── */}
        <div>
          <label className={labelCls}>Headers (JSON, optional)</label>
          <textarea
            rows={3}
            defaultValue={pretty(config.headers)}
            onChange={(e) => setJsonField("headers", e.target.value)}
            className={codeCls}
            placeholder={`{\n  "Accept": "application/json"\n}`}
            spellCheck={false}
          />
        </div>
        <div>
          <label className={labelCls}>Query Template (JSON, optional)</label>
          <textarea
            rows={3}
            defaultValue={pretty(config.queryTemplate)}
            onChange={(e) => setJsonField("queryTemplate", e.target.value)}
            className={codeCls}
            placeholder={`{\n  "q": "{{query}}"\n}`}
            spellCheck={false}
          />
          <p className={helpCls}>{`Values become URL query string. Supports {{var.path}} from input.`}</p>
        </div>
        {bodyAllowed && (
          <div>
            <label className={labelCls}>Body Template (JSON, optional)</label>
            <textarea
              rows={4}
              defaultValue={pretty(config.bodyTemplate)}
              onChange={(e) => setJsonField("bodyTemplate", e.target.value)}
              className={codeCls}
              placeholder={`{\n  "prompt": "{{prompt}}"\n}`}
              spellCheck={false}
            />
            <p className={helpCls}>{`Supports {{var.path}} substitution from input.`}</p>
          </div>
        )}
        <div>
          <label className={labelCls}>Response Transform (JSON, optional)</label>
          <textarea
            rows={3}
            defaultValue={pretty(config.responseTransform)}
            onChange={(e) => setJsonField("responseTransform", e.target.value)}
            className={codeCls}
            placeholder={`{\n  "candidates": "{{response.images}}"\n}`}
            spellCheck={false}
          />
          <p className={helpCls}>
            {`Reshapes the (post-poll, post-download) response. Scope: {{input.X}}, {{response.X}}.`}
          </p>
        </div>

        {/* Async polling — incompatible with responseType=binary */}
        {pollingAllowed && (
        <details open={hasAsync} className="border border-primary/15 rounded">
          <summary className="cursor-pointer px-3 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-secondary/80">
            Async Polling (optional)
          </summary>
          <div className="px-3 pb-3 pt-1 flex flex-col gap-3">
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div>
                <label className={labelCls}>Poll URL</label>
                <input
                  type="text"
                  value={s(polling, "url")}
                  onChange={(e) => setPolling("url", e.target.value)}
                  className={inputCls + " font-mono text-[12px]"}
                  placeholder="{{initialResponse.taskUrl}}"
                />
                <p className={helpCls}>
                  {`Scope: {{input.X}}, {{response.X}} (latest), {{initialResponse.X}} (POST body, frozen).`}
                </p>
              </div>
              <div>
                <label className={labelCls}>Poll Method</label>
                <select
                  value={s(polling, "method") || "GET"}
                  onChange={(e) => setPolling("method", e.target.value === "GET" ? undefined : e.target.value)}
                  className={inputCls}
                >
                  {HTTP_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Interval (ms)</label>
                <input
                  type="number"
                  min={250}
                  value={n(polling, "intervalMs")}
                  onChange={(e) =>
                    setPolling("intervalMs", e.target.value === "" ? undefined : Number(e.target.value))
                  }
                  className={inputCls}
                  placeholder="5000"
                />
              </div>
              <div>
                <label className={labelCls}>Total Timeout (ms)</label>
                <input
                  type="number"
                  min={1000}
                  value={n(polling, "timeoutMs")}
                  onChange={(e) =>
                    setPolling("timeoutMs", e.target.value === "" ? undefined : Number(e.target.value))
                  }
                  className={inputCls}
                  placeholder="600000"
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Poll Headers (JSON, optional)</label>
              <textarea
                rows={2}
                defaultValue={pretty(polling.headers)}
                onChange={(e) => {
                  const parsed = jsonOrNull(e.target.value);
                  if (parsed.ok)
                    setPolling("headers", parsed.value === null ? undefined : parsed.value);
                }}
                className={codeCls}
                placeholder={`{\n  "Accept": "application/json"\n}`}
                spellCheck={false}
              />
            </div>
            <ConditionRow
              label="Success When"
              cond={polling.successWhen}
              onChange={(v) => setPolling("successWhen", v)}
              inputCls={inputCls}
              labelCls={labelCls}
              helpCls={helpCls}
              help={`Polling stops & returns when response.<path> === <equals>.`}
            />
            <ConditionRow
              label="Failure When"
              cond={polling.failureWhen}
              onChange={(v) => setPolling("failureWhen", v)}
              inputCls={inputCls}
              labelCls={labelCls}
              helpCls={helpCls}
              help={`Polling throws when matched. For multiple conditions use Advanced JSON (array).`}
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Progress Path</label>
                <input
                  type="text"
                  value={s(polling, "progressPath")}
                  onChange={(e) => setPolling("progressPath", e.target.value)}
                  className={inputCls + " font-mono text-[12px]"}
                  placeholder="progress"
                />
                <p className={helpCls}>Dot-path to numeric 0-100 in poll body.</p>
              </div>
              <div>
                <label className={labelCls}>Progress Label Path</label>
                <input
                  type="text"
                  value={s(polling, "progressLabelPath")}
                  onChange={(e) => setPolling("progressLabelPath", e.target.value)}
                  className={inputCls + " font-mono text-[12px]"}
                  placeholder="status"
                />
              </div>
            </div>
          </div>
        </details>
        )}

        {/* Async download ─────────────────────────────────────────── */}
        <details open={hasAsync} className="border border-primary/15 rounded">
          <summary className="cursor-pointer px-3 py-2 font-label text-[10px] tracking-[0.25em] uppercase text-secondary/80">
            Async Download (optional)
          </summary>
          <div className="px-3 pb-3 pt-1 flex flex-col gap-3">
            <div>
              <label className={labelCls}>URL Path (in response)</label>
              <input
                type="text"
                value={s(download, "urlPath")}
                onChange={(e) => setDownload("urlPath", e.target.value)}
                className={inputCls + " font-mono text-[12px]"}
                placeholder="model_urls.glb"
              />
              <p className={helpCls}>Dot-path to a string URL inside the response. Fetched as bytes.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Attach Field</label>
                <input
                  type="text"
                  value={s(download, "field")}
                  onChange={(e) => setDownload("field", e.target.value)}
                  className={inputCls + " font-mono text-[12px]"}
                  placeholder="_download"
                />
              </div>
              <div>
                <label className={labelCls}>Max Bytes</label>
                <input
                  type="number"
                  min={1024}
                  value={n(download, "maxBytes")}
                  onChange={(e) =>
                    setDownload("maxBytes", e.target.value === "" ? undefined : Number(e.target.value))
                  }
                  className={inputCls}
                  placeholder="52428800 (50 MB)"
                />
              </div>
            </div>
          </div>
        </details>
      </div>
    );
  }

  if (kind === "LLM_PROMPT") {
    const provider = s(config, "provider") || "anthropic";
    const responseFormat = s(config, "responseFormat") || "text";
    const grounding = config.grounding === true;
    const supportsVision = provider === "anthropic" || provider === "gemini";
    const defaultEnv = LLM_DEFAULT_AUTH_ENV[provider] || "ANTHROPIC_API_KEY";

    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Provider</label>
            <select
              value={provider}
              onChange={(e) => setField("provider", e.target.value)}
              className={inputCls}
            >
              {LLM_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Model</label>
            <input
              type="text"
              value={s(config, "model")}
              onChange={(e) => setField("model", e.target.value)}
              className={inputCls + " font-mono text-[12px]"}
              placeholder="claude-opus-4-7"
              required
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>System Prompt</label>
          <textarea
            rows={3}
            value={s(config, "systemPrompt")}
            onChange={(e) => setField("systemPrompt", e.target.value)}
            className={inputCls + " resize-y"}
            placeholder="You are a helpful assistant."
          />
        </div>
        <div>
          <label className={labelCls}>User Template</label>
          <textarea
            rows={3}
            value={s(config, "userTemplate")}
            onChange={(e) => setField("userTemplate", e.target.value)}
            className={inputCls + " resize-y"}
            placeholder="{{prompt}}"
          />
          <p className={helpCls}>{`{{var.path}} pulls fields from skill input. Omit to JSON-stringify whole input.`}</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Max Tokens</label>
            <input
              type="number"
              min={1}
              max={32000}
              value={n(config, "maxTokens")}
              onChange={(e) => setField("maxTokens", e.target.value === "" ? undefined : Number(e.target.value))}
              className={inputCls}
              placeholder="1024"
            />
          </div>
          <div>
            <label className={labelCls}>Temperature</label>
            <input
              type="number"
              step={0.1}
              min={0}
              max={2}
              value={n(config, "temperature")}
              onChange={(e) => setField("temperature", e.target.value === "" ? undefined : Number(e.target.value))}
              className={inputCls}
              placeholder="(default)"
            />
            <p className={helpCls}>Opus 4.7+ rejects temperature — leave blank.</p>
          </div>
          <div>
            <label className={labelCls}>Auth Env Name</label>
            <input
              type="text"
              value={s(config, "authEnv")}
              onChange={(e) => setField("authEnv", e.target.value)}
              className={inputCls + " font-mono text-[12px]"}
              placeholder={defaultEnv}
            />
          </div>
        </div>

        {/* Response format ────────────────────────────────────────── */}
        <div>
          <label className={labelCls}>Response Format</label>
          <div className="flex gap-1 bg-surface-variant/30 border border-primary/20 rounded p-0.5 w-fit">
            {(["text", "json"] as const).map((rf) => {
              const active = responseFormat === rf;
              // Gemini + grounding forces text mode at runtime
              // (llmPrompt.ts:297). Disable the json toggle so admin
              // can't pick a setting backend will silently ignore.
              const jsonDisabled = rf === "json" && provider === "gemini" && grounding;
              return (
                <button
                  key={rf}
                  type="button"
                  disabled={jsonDisabled}
                  onClick={() => setField("responseFormat", rf === "text" ? undefined : "json")}
                  className={[
                    "font-label text-[10px] tracking-[0.2em] uppercase px-4 py-1.5 rounded transition-colors",
                    active
                      ? "bg-primary/20 text-primary"
                      : "text-on-surface-variant/70 hover:text-on-surface",
                    jsonDisabled ? "opacity-40 cursor-not-allowed" : "",
                  ].join(" ")}
                >
                  {rf}
                </button>
              );
            })}
          </div>
          <p className={helpCls}>
            {provider === "gemini" && grounding
              ? "Grounding is on — json is unavailable (backend would degrade to text)."
              : "json → handler JSON.parse the text (strip ```json fence)."}
          </p>
        </div>

        {/* Vision — Anthropic + Gemini only; OpenAI vision TBD */}
        {supportsVision && (
          <div>
            <label className={labelCls}>Vision — Image Paths Field</label>
            <input
              type="text"
              value={s(config, "imagePathsField")}
              onChange={(e) => setField("imagePathsField", e.target.value)}
              className={inputCls + " font-mono text-[12px]"}
              placeholder="files.imageAbsPaths"
            />
            <p className={helpCls}>
              Dot-path into input pointing at an array of absolute image paths. Max 8 images, 5 MB each.
              Blank = no vision.
            </p>
          </div>
        )}

        {/* Grounding ──────────────────────────────────────────────── */}
        {provider === "gemini" && (
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={grounding}
                onChange={(e) => {
                  const on = e.target.checked;
                  setField("grounding", on || undefined);
                  // Backend would silently drop json mode under grounding;
                  // wipe the stale flag so saved config reflects reality.
                  if (on && responseFormat === "json") setField("responseFormat", undefined);
                }}
                className="accent-primary"
              />
              <span className="font-label text-[10px] tracking-[0.25em] text-primary/80 uppercase">
                Enable Google Search Grounding
              </span>
            </label>
            <p className={helpCls}>
              Citations attached as <code>_citations</code>. Mutually exclusive with json response
              format (grounding wins, degrades to text).
            </p>
          </div>
        )}
      </div>
    );
  }

  if (kind === "MCP_SERVER") {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <label className={labelCls}>Server URL</label>
          <input
            type="text"
            value={s(config, "serverUrl")}
            onChange={(e) => setField("serverUrl", e.target.value)}
            className={inputCls + " font-mono text-[12px]"}
            placeholder="https://mcp.example.com"
          />
        </div>
        <div>
          <label className={labelCls}>Tool Name</label>
          <input
            type="text"
            value={s(config, "toolName")}
            onChange={(e) => setField("toolName", e.target.value)}
            className={inputCls + " font-mono text-[12px]"}
            placeholder="tool-name"
          />
        </div>
        <div>
          <label className={labelCls}>Auth Env Name</label>
          <input
            type="text"
            value={s(config, "authEnv")}
            onChange={(e) => setField("authEnv", e.target.value)}
            className={inputCls + " font-mono text-[12px]"}
            placeholder="MCP_API_KEY"
          />
        </div>
        <p className={helpCls}>MCP_SERVER handler is a Phase 5 placeholder — config saved but not yet routed.</p>
      </div>
    );
  }

  return null;
}

// Editor for a polling success/failure condition. Backend accepts a
// `{ path, equals }` object (failureWhen may also be an array — array
// case requires Advanced JSON). `equals` is parsed as JSON so admins
// can use strings ("SUCCEEDED"), numbers (1), booleans (true), or null.
function ConditionRow({
  label,
  cond,
  onChange,
  inputCls,
  labelCls,
  helpCls,
  help,
}: {
  label: string;
  cond: unknown;
  onChange: (v: unknown) => void;
  inputCls: string;
  labelCls: string;
  helpCls: string;
  help?: string;
}) {
  const single = isObject(cond) && !Array.isArray(cond) ? cond : null;
  const isArrayForm = Array.isArray(cond);
  const path = single && typeof single.path === "string" ? single.path : "";
  const equalsRaw =
    single && "equals" in single ? JSON.stringify(single.equals) : "";

  function update(nextPath: string, nextEqualsRaw: string) {
    const trimmedPath = nextPath.trim();
    const trimmedEq = nextEqualsRaw.trim();
    if (!trimmedPath && !trimmedEq) {
      onChange(undefined);
      return;
    }
    let parsed: unknown = trimmedEq;
    if (trimmedEq) {
      try {
        parsed = JSON.parse(trimmedEq);
      } catch {
        // Fall back to raw string — admin probably typed "SUCCEEDED" without
        // quotes. Storing it as-is is what they meant.
        parsed = trimmedEq;
      }
    }
    onChange({ path: trimmedPath, equals: parsed });
  }

  if (isArrayForm) {
    return (
      <div>
        <label className={labelCls}>{label}</label>
        <p className={helpCls}>
          Currently set to an array of conditions — edit via Advanced (raw JSON) to modify.
        </p>
      </div>
    );
  }

  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <input
          type="text"
          value={path}
          onChange={(e) => update(e.target.value, equalsRaw)}
          className={inputCls + " font-mono text-[12px]"}
          placeholder="path (e.g. status)"
        />
        <input
          type="text"
          value={equalsRaw}
          onChange={(e) => update(path, e.target.value)}
          className={inputCls + " font-mono text-[12px]"}
          placeholder={`equals (JSON: "SUCCEEDED", 1, true)`}
        />
      </div>
      {help && <p className={helpCls}>{help}</p>}
    </div>
  );
}
