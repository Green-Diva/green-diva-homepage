"use client";

// Orchestrator (AUTONOMOUS) editor — Phase 4. Configures the LLM tool-use
// loop that drives an autonomous agent. Save writes to PUT /dispatcher;
// Test Run hits POST /dry-run synchronously with the unsaved config.
//
// Tools shown read-only — they're whatever skills are currently equipped
// in slots 0..5 with status=ONLINE. Equipping a new skill from the Skill
// Library appears here automatically next render.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import type { AgentRow, EquipRow } from "../types";

type Props = {
  agent: AgentRow;
  equips: EquipRow[];
  onClose: () => void;
};

type Provider = "anthropic" | "openai";

type RunLog = Array<{
  stepId: string;
  skillId?: string;
  durationMs: number;
  ok: boolean;
  output?: unknown;
  errorCode?: string;
  errorMessage?: string;
}>;

type TestResult =
  | { kind: "idle" }
  | { kind: "running" }
  | {
      kind: "ok";
      output: { text?: string; iterations?: number; toolCallCount?: number };
      runLog: RunLog;
      durationMs: number;
    }
  | {
      kind: "err";
      errorCode: string;
      errorMessage: string;
      runLog: RunLog;
      durationMs?: number;
    };

const ANTHROPIC_MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
] as const;
const OPENAI_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4.1",
  "gpt-4-turbo",
  "o1-preview",
  "o1-mini",
] as const;

const DEFAULT_BY_PROVIDER: Record<Provider, { model: string; authEnv: string }> = {
  anthropic: { model: "claude-opus-4-7", authEnv: "ANTHROPIC_API_KEY" },
  openai: { model: "gpt-4o", authEnv: "OPENAI_API_KEY" },
};

type Drafts = {
  provider: Provider;
  model: string;
  systemPrompt: string;
  maxIterations: string;
  temperature: string;
  authEnv: string;
};

function loadDrafts(cfg: unknown): { drafts: Drafts; warning: string | null } {
  const fresh: Drafts = {
    provider: "anthropic",
    model: DEFAULT_BY_PROVIDER.anthropic.model,
    systemPrompt: "",
    maxIterations: "10",
    temperature: "1",
    authEnv: "",
  };
  if (cfg == null) return { drafts: fresh, warning: null };
  if (typeof cfg !== "object" || Array.isArray(cfg)) {
    return { drafts: fresh, warning: "Existing config has unknown shape — saving here will replace it." };
  }
  const c = cfg as Record<string, unknown>;
  if (c.version !== 1 || (c.provider !== "anthropic" && c.provider !== "openai")) {
    return { drafts: fresh, warning: "Existing config is from a previous era — saving here will replace it." };
  }
  return {
    drafts: {
      provider: c.provider,
      model: typeof c.model === "string" ? c.model : DEFAULT_BY_PROVIDER[c.provider].model,
      systemPrompt: typeof c.systemPrompt === "string" ? c.systemPrompt : "",
      maxIterations: typeof c.maxIterations === "number" ? String(c.maxIterations) : "10",
      temperature: typeof c.temperature === "number" ? String(c.temperature) : "1",
      authEnv: typeof c.authEnv === "string" ? c.authEnv : "",
    },
    warning: null,
  };
}

function buildConfig(d: Drafts) {
  return {
    version: 1 as const,
    provider: d.provider,
    model: d.model,
    ...(d.systemPrompt.trim() ? { systemPrompt: d.systemPrompt } : {}),
    maxIterations: Math.max(1, Math.min(50, Number(d.maxIterations) || 10)),
    temperature: Math.max(0, Math.min(2, Number(d.temperature) || 1)),
    ...(d.authEnv.trim() ? { authEnv: d.authEnv.trim() } : {}),
  };
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function OrchestratorEditor({ agent, equips, onClose }: Props) {
  const { locale } = useI18n();
  const router = useRouter();

  const initial = useMemo(() => loadDrafts(agent.dispatcherConfig), [agent.dispatcherConfig]);
  const [v, setV] = useState<Drafts>(initial.drafts);
  const [legacyWarning] = useState<string | null>(initial.warning);
  const [sampleInput, setSampleInput] = useState('"Find a tool to call and use it."');
  const [busy, setBusy] = useState(false);
  const [topErr, setTopErr] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult>({ kind: "idle" });
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const onlineEquips = useMemo(
    () =>
      equips
        .filter((e) => e.slotIndex !== null && e.skill.status === "ONLINE")
        .sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0)),
    [equips],
  );

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !busy) onClose();
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

  function upd<K extends keyof Drafts>(key: K, val: Drafts[K]) {
    setV((s) => ({ ...s, [key]: val }));
  }

  function onProviderChange(next: Provider) {
    setV((s) => {
      // Reset model to provider default if the current model isn't valid for the new provider.
      const validList = next === "anthropic" ? ANTHROPIC_MODELS : OPENAI_MODELS;
      const model = (validList as readonly string[]).includes(s.model)
        ? s.model
        : DEFAULT_BY_PROVIDER[next].model;
      return { ...s, provider: next, model };
    });
  }

  async function onSave() {
    setBusy(true);
    setTopErr(null);
    try {
      const r = await fetch(`/api/agents/${agent.id}/dispatcher`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: buildConfig(v) }),
      });
      setBusy(false);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setTopErr(typeof j.error === "string" ? j.error : "save failed");
        return;
      }
      router.refresh();
      onClose();
    } catch (e) {
      setBusy(false);
      setTopErr(e instanceof Error ? e.message : "save failed");
    }
  }

  async function onTestRun() {
    setTest({ kind: "running" });
    let parsedInput: unknown = null;
    if (sampleInput.trim()) {
      try {
        parsedInput = JSON.parse(sampleInput);
      } catch (e) {
        setTest({
          kind: "err",
          errorCode: "INVALID_INPUT_JSON",
          errorMessage: e instanceof Error ? e.message : "invalid sample input JSON",
          runLog: [],
        });
        return;
      }
    }
    try {
      const r = await fetch(`/api/agents/${agent.id}/dry-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: parsedInput,
          dispatcherConfig: buildConfig(v),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTest({
          kind: "err",
          errorCode: `HTTP_${r.status}`,
          errorMessage: typeof data.error === "string" ? data.error : "request failed",
          runLog: [],
        });
        return;
      }
      if (data.ok) {
        setTest({
          kind: "ok",
          output: data.output ?? {},
          runLog: Array.isArray(data.runLog) ? data.runLog : [],
          durationMs: data.durationMs ?? 0,
        });
      } else {
        setTest({
          kind: "err",
          errorCode: data.errorCode ?? "UNKNOWN",
          errorMessage: data.errorMessage ?? "",
          runLog: Array.isArray(data.runLog) ? data.runLog : [],
          durationMs: data.durationMs,
        });
      }
    } catch (e) {
      setTest({
        kind: "err",
        errorCode: "CLIENT_ERROR",
        errorMessage: e instanceof Error ? e.message : "fetch threw",
        runLog: [],
      });
    }
  }

  const inputCls =
    "w-full bg-surface-variant/30 border border-primary/20 rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary/60 focus:bg-surface-variant/50 transition-colors";
  const codeCls = inputCls + " font-mono text-[11px] resize-y";
  const labelCls = "font-label text-[10px] tracking-[0.25em] text-primary/70 uppercase mb-1 block";
  const modelList = v.provider === "anthropic" ? ANTHROPIC_MODELS : OPENAI_MODELS;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Orchestrator Config · ${agent.codename}`}
      className="fixed inset-0 z-[110] flex items-stretch justify-center bg-black/85 backdrop-blur-sm overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="relative w-full max-w-3xl my-6 mx-4">
        <div className="cyber-panel rounded-lg p-6 flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-label text-[10px] tracking-[0.3em] uppercase text-primary">
                {agent.codename} · Orchestrator Config
              </p>
              <h2 className="mt-1 font-headline text-2xl text-on-surface sacred-glow">
                Tool-use loop
              </h2>
              <p className="mt-1 text-xs text-on-surface-variant">
                LLM is given the equipped skills as tools and decides which to call. Loop runs until
                the model emits no tool calls or maxIterations is reached.
              </p>
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              disabled={busy}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-on-surface-variant hover:text-on-surface"
              aria-label="close"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {legacyWarning && (
            <div className="border border-amber-300/40 bg-amber-300/[0.06] text-amber-200 text-[11px] rounded-md px-3 py-2">
              {legacyWarning}
            </div>
          )}

          {/* Provider / Model */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Provider</label>
              <select
                value={v.provider}
                onChange={(e) => onProviderChange(e.target.value as Provider)}
                className={inputCls}
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Model</label>
              <select
                value={v.model}
                onChange={(e) => upd("model", e.target.value)}
                className={inputCls}
              >
                {modelList.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                {!(modelList as readonly string[]).includes(v.model) && (
                  <option value={v.model}>{v.model} (custom)</option>
                )}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Max Iterations</label>
              <input
                type="number"
                min={1}
                max={50}
                value={v.maxIterations}
                onChange={(e) => upd("maxIterations", e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Temperature</label>
              <input
                type="number"
                step={0.1}
                min={0}
                max={2}
                value={v.temperature}
                onChange={(e) => upd("temperature", e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Auth Env (override)</label>
              <input
                type="text"
                value={v.authEnv}
                onChange={(e) => upd("authEnv", e.target.value)}
                placeholder={DEFAULT_BY_PROVIDER[v.provider].authEnv}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>System Prompt</label>
            <textarea
              rows={5}
              value={v.systemPrompt}
              onChange={(e) => upd("systemPrompt", e.target.value)}
              className={inputCls + " resize-y"}
              placeholder="You are an agent that uses the available tools to solve the user's request..."
              spellCheck={false}
            />
          </div>

          {/* Tools preview (read-only) */}
          <div className="border-t border-primary/15 pt-4 flex flex-col gap-2">
            <h3 className="font-label text-[11px] tracking-[0.3em] text-primary/80 uppercase">
              Tools exposed to the model
            </h3>
            {onlineEquips.length === 0 ? (
              <p className="text-amber-200/80 text-[11px]">
                No ONLINE skills equipped — the orchestrator will refuse to run with NO_TOOLS.
                Equip a skill (Skill Library) and flip its status to ONLINE first.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {onlineEquips.map((e) => {
                  const name = locale === "zh" ? e.skill.nameZh : e.skill.nameEn;
                  const desc = locale === "zh" ? e.skill.descriptionZh : e.skill.descriptionEn;
                  return (
                    <li
                      key={e.id}
                      className="border border-primary/15 rounded p-2 bg-surface-variant/10"
                    >
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="font-mono text-primary/60">slot {e.slotIndex}</span>
                        <span className="text-on-surface">{name}</span>
                        <span className="font-mono text-[9px] text-on-surface-variant/60 ml-auto">
                          {e.skill.kind}
                        </span>
                      </div>
                      {desc && (
                        <p className="text-[10px] text-on-surface-variant/70 mt-0.5 line-clamp-2">{desc}</p>
                      )}
                      {e.skill.inputSchema && (
                        <details className="mt-1">
                          <summary className="font-label text-[9px] uppercase tracking-[0.2em] text-primary/50 cursor-pointer">
                            inputSchema
                          </summary>
                          <pre className="mt-1 font-mono text-[10px] text-on-surface-variant/80 whitespace-pre-wrap break-all max-h-24 overflow-auto">
                            {JSON.stringify(e.skill.inputSchema, null, 2)}
                          </pre>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Test Run */}
          <div className="border-t border-primary/15 pt-4 flex flex-col gap-2">
            <h3 className="font-label text-[11px] tracking-[0.3em] text-primary/80 uppercase">
              Test Run
            </h3>
            <p className="font-label text-[9px] tracking-[0.15em] text-on-surface-variant/60">
              Runs the loop above synchronously. Uses unsaved edits. Burns LLM tokens.
            </p>
            <label className={labelCls}>Sample Input (JSON)</label>
            <textarea
              rows={3}
              value={sampleInput}
              onChange={(e) => setSampleInput(e.target.value)}
              className={codeCls}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={onTestRun}
              disabled={test.kind === "running"}
              className="self-start cyber-btn font-label text-[10px] tracking-[0.2em] uppercase min-h-[36px] px-4 flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[14px]">play_arrow</span>
              {test.kind === "running" ? "Running…" : "Test Run"}
            </button>
            {test.kind === "ok" && (
              <div className="mt-2 border border-emerald-400/30 rounded p-3 bg-emerald-400/[0.05] text-[11px]">
                <p className="font-label text-[10px] tracking-[0.25em] text-emerald-300 uppercase">
                  ✓ OK · {formatDuration(test.durationMs)} · {test.output.iterations ?? 0} iter ·{" "}
                  {test.output.toolCallCount ?? 0} tool calls
                </p>
                {test.output.text && (
                  <details className="mt-2" open>
                    <summary className="font-label text-[9px] uppercase tracking-[0.2em] cursor-pointer text-primary/70">
                      assistant text
                    </summary>
                    <pre className="mt-1 font-mono text-[10px] whitespace-pre-wrap break-words max-h-48 overflow-auto">
                      {test.output.text}
                    </pre>
                  </details>
                )}
                {test.runLog.length > 0 && <RunLogTrace log={test.runLog} />}
              </div>
            )}
            {test.kind === "err" && (
              <div className="mt-2 border border-error/40 rounded p-3 bg-error/[0.05] text-[11px]">
                <p className="font-label text-[10px] tracking-[0.25em] text-error uppercase">
                  ✗ {test.errorCode}
                  {test.durationMs !== undefined ? ` · ${formatDuration(test.durationMs)}` : ""}
                </p>
                <p className="mt-1 text-error/80 whitespace-pre-wrap break-all">{test.errorMessage}</p>
                {test.runLog.length > 0 && <RunLogTrace log={test.runLog} />}
              </div>
            )}
          </div>

          {topErr && <p className="text-error text-sm">{topErr}</p>}

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-primary/10">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="font-label text-[10px] tracking-[0.2em] uppercase text-on-surface-variant hover:text-on-surface min-h-[44px] px-4"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={busy}
              className="cyber-btn font-label text-[10px] tracking-[0.2em] uppercase min-h-[44px] px-6"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    portal,
  );
}

function RunLogTrace({ log }: { log: RunLog }) {
  return (
    <details className="mt-2" open>
      <summary className="font-label text-[9px] uppercase tracking-[0.2em] cursor-pointer text-primary/70">
        run log · {log.length} step(s)
      </summary>
      <ol className="mt-1 flex flex-col gap-1">
        {log.map((entry, i) => (
          <li
            key={i}
            className={`font-mono text-[10px] px-2 py-1 rounded border ${entry.ok ? "border-emerald-400/30 bg-emerald-400/[0.04] text-emerald-300/90" : "border-error/30 bg-error/[0.04] text-error/90"}`}
          >
            <div className="flex items-center gap-2">
              <span>{entry.ok ? "✓" : "✗"}</span>
              <span>{entry.stepId}</span>
              <span className="text-on-surface-variant/50">· {entry.durationMs}ms</span>
              {entry.errorCode && <span className="ml-auto text-error/80">{entry.errorCode}</span>}
            </div>
            {entry.errorMessage && (
              <p className="mt-0.5 text-error/80 whitespace-pre-wrap break-all">{entry.errorMessage}</p>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
