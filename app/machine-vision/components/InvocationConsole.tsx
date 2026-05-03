"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { AgentRow } from "../types";

type InvocationLog = {
  id: string;
  ok: boolean;
  source: string;
  latencyMs: number | null;
  errorMessage: string | null;
  createdAt: string;
};

type InvokeResponse =
  | { ok: true; output: unknown; latencyMs: number; invocationId: string }
  | { ok: false; error: string; latencyMs: number; invocationId: string | null };

const PLACEHOLDER = '{\n  "prompt": "hello"\n}';

export default function InvocationConsole({ agent, isAdmin }: { agent: AgentRow; isAdmin: boolean }) {
  const t = useT();
  const [input, setInput] = useState(PLACEHOLDER);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InvokeResponse | null>(null);
  const [history, setHistory] = useState<InvocationLog[]>([]);
  const [parseErr, setParseErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    fetch(`/api/agents/${agent.id}/invocations?limit=5`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: InvocationLog[]) => {
        if (alive) setHistory(rows);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      alive = false;
    };
  }, [agent.id, isAdmin]);

  if (!isAdmin) {
    return (
      <div className="text-on-surface-variant text-sm">
        <div className="font-label text-[10px] tracking-[0.3em] text-outline uppercase mb-2">
          {t.machineVision.invocationConsole}
        </div>
        <p>{t.machineVision.invokeAdminOnly}</p>
      </div>
    );
  }

  async function onInvoke() {
    setBusy(true);
    setResult(null);
    setParseErr(null);

    let parsed: unknown;
    try {
      parsed = input.trim() ? JSON.parse(input) : null;
    } catch {
      setParseErr(t.machineVision.invokeBadJson);
      setBusy(false);
      return;
    }

    const r = await fetch(`/api/agents/${agent.id}/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: parsed }),
    });

    if (r.status === 429) {
      setBusy(false);
      setResult({ ok: false, error: t.machineVision.invokeRateLimited, latencyMs: 0, invocationId: null });
      return;
    }

    const data = (await r.json().catch(() => ({}))) as InvokeResponse;
    setBusy(false);
    setResult(data);
    fetch(`/api/agents/${agent.id}/invocations?limit=5`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: InvocationLog[]) => setHistory(rows))
      .catch(() => {
        /* ignore */
      });
  }

  const disabled = !agent.enabled || agent.status === "OFFLINE";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-label text-[11px] tracking-[0.3em] text-primary uppercase">
            {t.machineVision.invocationConsole}
          </div>
          <div className="font-label text-[10px] tracking-[0.2em] text-on-surface-variant mt-0.5">
            {t.machineVision.invocationConsoleHint}
          </div>
        </div>
        <div className="flex items-center gap-2 font-label text-[9px] tracking-[0.25em] uppercase">
          <span className="px-2 py-1 border border-primary/30 text-primary rounded-sm bg-primary/[0.05]">
            {agent.provider}
          </span>
          {agent.model ? (
            <span className="px-2 py-1 border border-outline-variant text-on-surface-variant rounded-sm">{agent.model}</span>
          ) : null}
          <span
            className={`px-2 py-1 border rounded-sm ${
              agent.enabled ? "border-secondary/40 text-secondary bg-secondary/[0.06]" : "border-rose-400/40 text-rose-300"
            }`}
          >
            {agent.enabled ? "ENABLED" : "DISABLED"}
          </span>
        </div>
      </div>

      {disabled ? (
        <div className="font-label text-[10px] tracking-[0.2em] text-rose-300">{t.machineVision.invokeDisabled}</div>
      ) : null}

      <label className="block">
        <span className="font-label text-[10px] tracking-[0.25em] text-on-surface-variant uppercase">
          {t.machineVision.invokeInputLabel}
        </span>
        <textarea
          className="mt-1 w-full rounded-md border border-primary/20 bg-surface-container-lowest px-3 py-2 font-mono text-xs text-on-surface focus:border-primary/60 focus:outline-none min-h-[88px]"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
        />
      </label>
      {parseErr ? <p className="text-xs text-rose-300">{parseErr}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || disabled}
          onClick={onInvoke}
          className="min-h-[44px] px-4 py-2 bg-primary/10 border border-primary/40 text-primary font-label text-[10px] tracking-[0.3em] uppercase rounded-md hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-base" aria-hidden>
            play_arrow
          </span>
          {busy ? t.machineVision.invoking : t.machineVision.invokeButton}
        </button>
        {result?.ok ? (
          <span className="font-label text-[10px] tracking-[0.25em] text-secondary">
            {format(t.machineVision.invokeLatency, { ms: result.latencyMs })}
          </span>
        ) : null}
      </div>

      {result ? (
        <div>
          <div className="font-label text-[10px] tracking-[0.25em] text-on-surface-variant uppercase mb-1">
            {result.ok ? t.machineVision.invokeOutputLabel : t.machineVision.invokeFailed}
          </div>
          <pre
            className={[
              "rounded-md border px-3 py-2 font-mono text-xs whitespace-pre-wrap break-words max-h-48 overflow-auto",
              result.ok
                ? "border-primary/30 bg-surface-container-lowest text-on-surface"
                : "border-rose-400/40 bg-rose-400/[0.05] text-rose-200",
            ].join(" ")}
          >
            {result.ok ? safeFormat(result.output) : result.error}
          </pre>
        </div>
      ) : null}

      <div>
        <div className="font-label text-[10px] tracking-[0.25em] text-on-surface-variant uppercase mb-1">
          {t.machineVision.invokeRecent}
        </div>
        {history.length === 0 ? (
          <div className="font-label text-[10px] tracking-[0.2em] text-outline">
            {t.machineVision.invokeNoHistory}
          </div>
        ) : (
          <ul className="space-y-1 text-xs">
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-3 font-mono">
                <span className={h.ok ? "text-secondary" : "text-rose-300"}>{h.ok ? "OK" : "ERR"}</span>
                <span className="text-on-surface-variant tabular-nums">{h.latencyMs ?? 0}ms</span>
                <span className="text-outline">{h.source}</span>
                <span className="text-outline truncate">{new Date(h.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function safeFormat(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
