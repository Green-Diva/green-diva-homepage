"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { SkillRow, HandlerKind } from "../types";

type Props = {
  mode: "create" | "edit";
  initial?: SkillRow | null;
  onClose: () => void;
  onSaved: () => void;
};

const HANDLER_KIND_OPTIONS: HandlerKind[] = ["INTERNAL", "HTTP_API", "LLM_PROMPT", "MCP_SERVER"];
const STATUS_OPTIONS = ["ONLINE", "OFFLINE"] as const;

// Internal handler slugs registered in lib/skills/handlers/internal/index.ts.
// Hardcoded here on purpose — adding a new internal handler is a code commit
// (CLAUDE.md "no ZIP plugins"), so the dropdown stays in lockstep manually.
const INTERNAL_HANDLER_SLUGS = [
  "relic-files-summary",
  "relic-gemini-researcher",
  "relic-smart-image-pick",
  "relic-cutout",
  "meshy-3d",
  "relic-image-pick",
] as const;

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const LLM_PROVIDERS = ["anthropic", "openai"] as const;

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
    handlerKind: (initial?.handlerKind ?? "INTERNAL") as HandlerKind,
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

export default function SkillEditor({ mode, initial, onClose, onSaved }: Props) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = useState(() => blank(initial));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      "handler", "method", "url", "authEnv", "authScheme", "authHeader",
      "headers", "bodyTemplate", "queryTemplate", "responseType", "timeoutMs",
      "provider", "model", "systemPrompt", "userTemplate", "maxTokens",
      "temperature", "responseFormat", "imagePathsField",
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);

    let finalConfig: Record<string, unknown> = config;
    if (advanced) {
      const parsed = jsonOrNull(advDraft);
      if (!parsed.ok) {
        setErr(`Advanced JSON: ${parsed.error}`);
        setBusy(false);
        return;
      }
      if (parsed.value !== null && !isObject(parsed.value)) {
        setErr("Advanced JSON must be an object");
        setBusy(false);
        return;
      }
      finalConfig = (parsed.value as Record<string, unknown>) ?? {};
    }

    const inSchema = jsonOrNull(v.inputSchema);
    if (!inSchema.ok) {
      setErr(`inputSchema: ${inSchema.error}`);
      setBusy(false);
      return;
    }
    const outSchema = jsonOrNull(v.outputSchema);
    if (!outSchema.ok) {
      setErr(`outputSchema: ${outSchema.error}`);
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
      handlerKind: v.handlerKind,
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

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === "create" ? t.agentControl.skillCreateNew : t.agentControl.skillEdit}
      className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/85 backdrop-blur-sm overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl my-auto p-4 flex flex-col gap-0">
        <div className="cyber-panel rounded-lg p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4">
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

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {/* ── Identity ─────────────────────────────────────────────── */}
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
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={labelCls}>Slug (machine ID)</label>
              <input
                type="text"
                value={v.slug}
                onChange={(e) => upd("slug", e.target.value)}
                className={inputCls + " font-mono text-[12px]"}
                placeholder={mode === "create" ? "(auto-derived from Name EN)" : ""}
                pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
              />
              <p className={helpCls}>
                Stable kebab-case ID — used as LLM tool name. Don&apos;t rename casually; old
                tool_use history breaks. Leave blank on create to derive from Name EN.
              </p>
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

            {/* ── Runtime: Handler ─────────────────────────────────────── */}
            <div className={sectionCls}>
              <div className="flex items-center justify-between gap-3 mb-3">
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
              <div className="mb-3">
                <label className={labelCls}>Handler Type</label>
                <select
                  value={v.handlerKind}
                  onChange={(e) => onHandlerKindChange(e.target.value as HandlerKind)}
                  className={inputCls}
                  required
                >
                  {HANDLER_KIND_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <p className={helpCls}>
                  {v.handlerKind === "HTTP_API" && "REST endpoint. authEnv stays as env name; never paste keys."}
                  {v.handlerKind === "LLM_PROMPT" && "LLM call. Anthropic + OpenAI supported."}
                  {v.handlerKind === "MCP_SERVER" && "Remote MCP agent. Placeholder until Phase 5."}
                  {v.handlerKind === "INTERNAL" && "In-repo function dispatched by slug. Add new ones via PR."}
                </p>
              </div>

              {advanced ? (
                <div>
                  <label className={labelCls}>Handler Config (raw JSON)</label>
                  <textarea
                    rows={10}
                    value={advDraft}
                    onChange={(e) => setAdvDraft(e.target.value)}
                    className={codeCls}
                    spellCheck={false}
                  />
                  <p className={helpCls}>
                    Use this for fields not exposed by the form (e.g. <code>imagePathsField</code>,{" "}
                    <code>queryTemplate</code>, <code>timeoutMs</code>). Keys named{" "}
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

            {/* ── Schemas ───────────────────────────────────────────── */}
            <div className={sectionCls}>
              <h3 className={sectionTitleCls}>IO Contracts</h3>
              <div>
                <label className={labelCls}>Input Schema (JSON Schema, optional)</label>
                <textarea
                  rows={5}
                  value={v.inputSchema}
                  onChange={(e) => upd("inputSchema", e.target.value)}
                  className={codeCls}
                  placeholder={SCHEMA_TEMPLATE}
                  spellCheck={false}
                />
              </div>
              <div className="mt-3">
                <label className={labelCls}>Output Schema (JSON Schema, optional)</label>
                <textarea
                  rows={5}
                  value={v.outputSchema}
                  onChange={(e) => upd("outputSchema", e.target.value)}
                  className={codeCls}
                  placeholder={SCHEMA_TEMPLATE}
                  spellCheck={false}
                />
              </div>
              {mode === "edit" && (
                <p className={helpCls + " mt-3"}>
                  Use the <span className="text-primary/80">Test</span> button on the skill card to
                  invoke against current saved config.
                </p>
              )}
            </div>

            {err && <p className="text-error text-sm">{err}</p>}

            <div className="flex items-center justify-between gap-3 pt-1">
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
              <div className="flex gap-3">
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
          </form>
        </div>
      </div>
    </div>,
    portal,
  );
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
  if (kind === "INTERNAL") {
    return (
      <div>
        <label className={labelCls}>Internal Handler</label>
        <select
          value={s(config, "handler")}
          onChange={(e) => setField("handler", e.target.value)}
          className={inputCls}
          required
        >
          <option value="">— select —</option>
          {INTERNAL_HANDLER_SLUGS.map((slug) => (
            <option key={slug} value={slug}>
              {slug}
            </option>
          ))}
        </select>
        <p className={helpCls}>Handler must be registered in lib/skills/handlers/internal/index.ts.</p>
      </div>
    );
  }

  if (kind === "HTTP_API") {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[120px_1fr] gap-3">
          <div>
            <label className={labelCls}>Method</label>
            <select
              value={s(config, "method") || "POST"}
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
      </div>
    );
  }

  if (kind === "LLM_PROMPT") {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Provider</label>
            <select
              value={s(config, "provider") || "anthropic"}
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
              placeholder="(per-provider default)"
            />
          </div>
        </div>
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
