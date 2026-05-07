"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { SkillRow, HandlerKind } from "../types";
import type { AgentSkillKind } from "@/lib/agentTypes";

type Props = {
  mode: "create" | "edit";
  initial?: SkillRow | null;
  onClose: () => void;
  onSaved: () => void;
};

const KIND_OPTIONS: AgentSkillKind[] = ["PASSIVE", "ACTIVE", "ULTIMATE"];
const LEVEL_OPTIONS = [1, 2, 3, 4, 5, 6] as const;
const HANDLER_KIND_OPTIONS: HandlerKind[] = ["HTTP_API", "LLM_PROMPT", "MCP_SERVER", "INTERNAL"];
const STATUS_OPTIONS = ["ONLINE", "OFFLINE"] as const;

// Templates seeded into handlerConfig when admin first picks a handlerKind.
// Documents the expected shape better than a blank object.
const HANDLER_CONFIG_TEMPLATE: Record<HandlerKind, string> = {
  HTTP_API: JSON.stringify(
    {
      method: "POST",
      url: "https://api.example.com/v1/endpoint",
      authEnv: "EXAMPLE_API_KEY",
      headers: {},
      bodyTemplate: { prompt: "{{prompt}}" },
    },
    null,
    2,
  ),
  LLM_PROMPT: JSON.stringify(
    {
      provider: "anthropic",
      model: "claude-opus-4-7",
      systemPrompt: "You are a helpful assistant.",
      userTemplate: "{{prompt}}",
      maxTokens: 1024,
      temperature: 1.0,
    },
    null,
    2,
  ),
  MCP_SERVER: JSON.stringify(
    {
      serverUrl: "https://mcp.example.com",
      toolName: "tool-name",
      authEnv: "MCP_API_KEY",
    },
    null,
    2,
  ),
  INTERNAL: JSON.stringify(
    {
      handler: "<slug-registered-in-internalHandlers>",
    },
    null,
    2,
  ),
};

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

const SAMPLE_INPUT_TEMPLATE = JSON.stringify({ prompt: "Hello world" }, null, 2);

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
    level: String(initial?.level ?? 1),
    icon: initial?.icon ?? "",
    nameEn: initial?.nameEn ?? "",
    nameZh: initial?.nameZh ?? "",
    kind: (initial?.kind ?? "PASSIVE") as AgentSkillKind,
    status: (initial?.status ?? "OFFLINE") as "ONLINE" | "OFFLINE",
    costAp: String(initial?.costAp ?? 0),
    descriptionEn: initial?.descriptionEn ?? "",
    descriptionZh: initial?.descriptionZh ?? "",
    handlerKind: (initial?.handlerKind ?? "INTERNAL") as HandlerKind,
    handlerConfig: initial?.handlerConfig
      ? JSON.stringify(initial.handlerConfig, null, 2)
      : HANDLER_CONFIG_TEMPLATE[initial?.handlerKind ?? "INTERNAL"],
    inputSchema: initial?.inputSchema ? JSON.stringify(initial.inputSchema, null, 2) : "",
    outputSchema: initial?.outputSchema ? JSON.stringify(initial.outputSchema, null, 2) : "",
  };
}

type TestResult =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; output: unknown; durationMs: number }
  | {
      kind: "err";
      errorCode: string;
      errors: string[];
      output?: unknown;
      schemaErrors?: { input?: string[]; output?: string[] };
      durationMs?: number;
    };

export default function SkillEditor({ mode, initial, onClose, onSaved }: Props) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = useState(() => blank(initial));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sampleInput, setSampleInput] = useState(SAMPLE_INPUT_TEMPLATE);
  const [test, setTest] = useState<TestResult>({ kind: "idle" });
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

  function onHandlerKindChange(next: HandlerKind) {
    setV((s) => {
      // Replace handlerConfig with the template when user switches kinds *and*
      // the previous handlerConfig is empty or matches a template (heuristic:
      // user hasn't customized it yet). Otherwise preserve their edits.
      const cur = s.handlerConfig.trim();
      const isTemplate = Object.values(HANDLER_CONFIG_TEMPLATE).some((t) => t.trim() === cur);
      const isEmpty = cur === "" || cur === "{}";
      const handlerConfig = isTemplate || isEmpty ? HANDLER_CONFIG_TEMPLATE[next] : s.handlerConfig;
      return { ...s, handlerKind: next, handlerConfig };
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);

    const cfg = jsonOrNull(v.handlerConfig);
    if (!cfg.ok) {
      setErr(`handlerConfig: ${cfg.error}`);
      setBusy(false);
      return;
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

    const body = {
      level: Number(v.level),
      icon: v.icon.trim(),
      nameEn: v.nameEn.trim(),
      nameZh: v.nameZh.trim(),
      kind: v.kind,
      status: v.status,
      costAp: Number(v.costAp),
      descriptionEn: v.descriptionEn.trim(),
      descriptionZh: v.descriptionZh.trim(),
      handlerKind: v.handlerKind,
      handlerConfig: cfg.value ?? {},
      inputSchema: inSchema.value,
      outputSchema: outSchema.value,
    };
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

  async function onTestInvoke() {
    if (!initial) {
      setTest({ kind: "err", errorCode: "NOT_SAVED", errors: ["Save the skill first, then test."] });
      return;
    }
    const inp = jsonOrNull(sampleInput);
    if (!inp.ok) {
      setTest({ kind: "err", errorCode: "INVALID_INPUT_JSON", errors: [`sample input: ${inp.error}`] });
      return;
    }
    setTest({ kind: "running" });
    try {
      const r = await fetch(`/api/skills/${initial.id}/test-invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: inp.value }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTest({
          kind: "err",
          errorCode: "HTTP_" + r.status,
          errors: [typeof data.error === "string" ? data.error : "request failed"],
        });
        return;
      }
      if (data.ok) {
        setTest({ kind: "ok", output: data.output, durationMs: data.durationMs ?? 0 });
      } else {
        setTest({
          kind: "err",
          errorCode: data.errorCode ?? "UNKNOWN",
          errors: data.errors ?? [],
          output: data.output,
          schemaErrors: data.schemaErrors,
          durationMs: data.durationMs,
        });
      }
    } catch (e) {
      setTest({ kind: "err", errorCode: "CLIENT_ERROR", errors: [e instanceof Error ? e.message : "fetch threw"] });
    }
  }

  const inputCls =
    "w-full bg-surface-variant/30 border border-primary/20 rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary/60 focus:bg-surface-variant/50 transition-colors";
  const codeCls = inputCls + " font-mono text-[11px] resize-y";
  const labelCls = "font-label text-[10px] tracking-[0.25em] text-primary/70 uppercase mb-1 block";
  const sectionCls = "border-t border-primary/15 pt-4";
  const sectionTitleCls = "font-label text-[11px] tracking-[0.3em] text-secondary/80 uppercase mb-3";

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
                  {LEVEL_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      LV.{n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Kind (badge)</label>
                <select
                  value={v.kind}
                  onChange={(e) => upd("kind", e.target.value as AgentSkillKind)}
                  className={inputCls}
                  required
                >
                  {KIND_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div>
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

            <div className="grid grid-cols-2 gap-4">
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
                <label className={labelCls}>AP Cost</label>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={v.costAp}
                  onChange={(e) => upd("costAp", e.target.value)}
                  className={inputCls}
                />
              </div>
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
              <h3 className={sectionTitleCls}>Runtime — Handler</h3>
              <div className="mb-3">
                <label className={labelCls}>Handler Kind</label>
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
                <p className="font-label text-[9px] tracking-[0.15em] text-on-surface-variant/60 mt-1">
                  {v.handlerKind === "HTTP_API" && "REST endpoint. authEnv stays as env name; never paste keys."}
                  {v.handlerKind === "LLM_PROMPT" && "LLM call. Phase 1: Anthropic only. OpenAI lands Phase 4."}
                  {v.handlerKind === "MCP_SERVER" && "Remote MCP agent. Placeholder until Phase 5."}
                  {v.handlerKind === "INTERNAL" && "In-repo function dispatched by slug. Must be committed first."}
                </p>
              </div>
              <div>
                <label className={labelCls}>Handler Config (JSON)</label>
                <textarea
                  rows={9}
                  value={v.handlerConfig}
                  onChange={(e) => upd("handlerConfig", e.target.value)}
                  className={codeCls}
                  spellCheck={false}
                />
              </div>
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
            </div>

            {/* ── Test Invoke ──────────────────────────────────────── */}
            {mode === "edit" && (
              <div className={sectionCls}>
                <h3 className={sectionTitleCls}>Test Invoke</h3>
                <p className="font-label text-[9px] tracking-[0.15em] text-on-surface-variant/60 mb-2">
                  Save changes first, then run this against current saved config.
                </p>
                <label className={labelCls}>Sample Input (JSON)</label>
                <textarea
                  rows={4}
                  value={sampleInput}
                  onChange={(e) => setSampleInput(e.target.value)}
                  className={codeCls}
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={onTestInvoke}
                  disabled={test.kind === "running"}
                  className="cyber-btn font-label text-[10px] tracking-[0.2em] uppercase min-h-[36px] px-4 mt-3 flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                  {test.kind === "running" ? "Invoking…" : "Test Invoke"}
                </button>

                {test.kind !== "idle" && test.kind !== "running" && (
                  <div className="mt-3 border border-primary/20 rounded p-3 bg-surface-variant/20 text-[11px]">
                    {test.kind === "ok" ? (
                      <>
                        <p className="font-label text-[10px] tracking-[0.25em] text-primary uppercase">
                          ✓ OK · {test.durationMs}ms
                        </p>
                        <pre className="mt-2 font-mono text-[11px] text-on-surface whitespace-pre-wrap break-all max-h-48 overflow-auto">
                          {JSON.stringify(test.output, null, 2)}
                        </pre>
                      </>
                    ) : (
                      <>
                        <p className="font-label text-[10px] tracking-[0.25em] text-error uppercase">
                          ✗ {test.errorCode}
                          {test.durationMs !== undefined ? ` · ${test.durationMs}ms` : ""}
                        </p>
                        <ul className="mt-2 list-disc list-inside text-error/80 text-[11px]">
                          {test.errors.map((m, i) => (
                            <li key={i}>{m}</li>
                          ))}
                        </ul>
                        {test.schemaErrors?.input && test.schemaErrors.input.length > 0 && (
                          <details className="mt-2">
                            <summary className="font-label text-[9px] uppercase tracking-[0.2em] cursor-pointer">
                              input schema violations
                            </summary>
                            <ul className="mt-1 list-disc list-inside text-on-surface-variant/80">
                              {test.schemaErrors.input.map((m, i) => (
                                <li key={i}>{m}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                        {test.schemaErrors?.output && test.schemaErrors.output.length > 0 && (
                          <details className="mt-2">
                            <summary className="font-label text-[9px] uppercase tracking-[0.2em] cursor-pointer">
                              output schema violations
                            </summary>
                            <ul className="mt-1 list-disc list-inside text-on-surface-variant/80">
                              {test.schemaErrors.output.map((m, i) => (
                                <li key={i}>{m}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                        {test.output !== undefined && (
                          <details className="mt-2">
                            <summary className="font-label text-[9px] uppercase tracking-[0.2em] cursor-pointer">
                              raw output
                            </summary>
                            <pre className="mt-1 font-mono text-[10px] whitespace-pre-wrap break-all max-h-32 overflow-auto">
                              {JSON.stringify(test.output, null, 2)}
                            </pre>
                          </details>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

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
