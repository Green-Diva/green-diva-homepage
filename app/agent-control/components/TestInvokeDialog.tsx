"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";
import type { SkillRow } from "../types";

type Props = {
  skill: SkillRow;
  onClose: () => void;
};

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

export default function TestInvokeDialog({ skill, onClose }: Props) {
  const t = useT();
  const [sampleInput, setSampleInput] = useState(SAMPLE_INPUT_TEMPLATE);
  const [result, setResult] = useState<TestResult>({ kind: "idle" });
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && result.kind !== "running") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, result.kind]);

  const portal = useMemo(() => (typeof document !== "undefined" ? document.body : null), []);
  if (!portal) return null;

  async function onRun() {
    const inp = jsonOrNull(sampleInput);
    if (!inp.ok) {
      setResult({ kind: "err", errorCode: "INVALID_INPUT_JSON", errors: [`sample input: ${inp.error}`] });
      return;
    }
    setResult({ kind: "running" });
    try {
      const r = await fetch(`/api/skills/${skill.id}/test-invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: inp.value }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setResult({
          kind: "err",
          errorCode: "HTTP_" + r.status,
          errors: [typeof data.error === "string" ? data.error : "request failed"],
        });
        return;
      }
      if (data.ok) {
        setResult({ kind: "ok", output: data.output, durationMs: data.durationMs ?? 0 });
      } else {
        setResult({
          kind: "err",
          errorCode: data.errorCode ?? "UNKNOWN",
          errors: data.errors ?? [],
          output: data.output,
          schemaErrors: data.schemaErrors,
          durationMs: data.durationMs,
        });
      }
    } catch (e) {
      setResult({ kind: "err", errorCode: "CLIENT_ERROR", errors: [e instanceof Error ? e.message : "fetch threw"] });
    }
  }

  const inputCls =
    "w-full bg-surface-variant/30 border border-primary/20 rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary/60 focus:bg-surface-variant/50 transition-colors";
  const codeCls = inputCls + " font-mono text-[11px] resize-y";
  const labelCls = "font-label text-[10px] tracking-[0.25em] text-primary/70 uppercase mb-1 block";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.agentControl.skillTestInvokeTitle}
      className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/85 backdrop-blur-sm overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && result.kind !== "running") onClose();
      }}
    >
      <div className="relative w-full max-w-xl my-auto p-4 flex flex-col gap-0">
        <div className="cyber-panel rounded-lg p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span
                className="material-symbols-outlined text-[24px] text-primary/80 shrink-0"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {skill.icon || "play_arrow"}
              </span>
              <div className="min-w-0">
                <h2 className="font-label text-[11px] tracking-[0.3em] text-primary uppercase truncate">
                  {t.agentControl.skillTestInvokeTitle}
                </h2>
                <p className="font-mono text-[11px] text-on-surface-variant/70 truncate">
                  {skill.slug ?? skill.nameEn}
                </p>
              </div>
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              disabled={result.kind === "running"}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
              aria-label="close"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          <div>
            <label className={labelCls}>Sample Input (JSON)</label>
            <textarea
              rows={6}
              value={sampleInput}
              onChange={(e) => setSampleInput(e.target.value)}
              className={codeCls}
              spellCheck={false}
              disabled={result.kind === "running"}
            />
          </div>

          <button
            type="button"
            onClick={onRun}
            disabled={result.kind === "running"}
            className="cyber-btn font-label text-[10px] tracking-[0.2em] uppercase min-h-[44px] px-5 flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[16px]">play_arrow</span>
            {result.kind === "running" ? "Invoking…" : "Run"}
          </button>

          {result.kind !== "idle" && result.kind !== "running" && (
            <div className="border border-primary/20 rounded p-3 bg-surface-variant/20 text-[11px]">
              {result.kind === "ok" ? (
                <>
                  <p className="font-label text-[10px] tracking-[0.25em] text-primary uppercase">
                    ✓ OK · {result.durationMs}ms
                  </p>
                  <pre className="mt-2 font-mono text-[11px] text-on-surface whitespace-pre-wrap break-all max-h-64 overflow-auto">
                    {JSON.stringify(result.output, null, 2)}
                  </pre>
                </>
              ) : (
                <>
                  <p className="font-label text-[10px] tracking-[0.25em] text-error uppercase">
                    ✗ {result.errorCode}
                    {result.durationMs !== undefined ? ` · ${result.durationMs}ms` : ""}
                  </p>
                  <ul className="mt-2 list-disc list-inside text-error/80 text-[11px]">
                    {result.errors.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                  {result.schemaErrors?.input && result.schemaErrors.input.length > 0 && (
                    <details className="mt-2">
                      <summary className="font-label text-[9px] uppercase tracking-[0.2em] cursor-pointer">
                        input schema violations
                      </summary>
                      <ul className="mt-1 list-disc list-inside text-on-surface-variant/80">
                        {result.schemaErrors.input.map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {result.schemaErrors?.output && result.schemaErrors.output.length > 0 && (
                    <details className="mt-2">
                      <summary className="font-label text-[9px] uppercase tracking-[0.2em] cursor-pointer">
                        output schema violations
                      </summary>
                      <ul className="mt-1 list-disc list-inside text-on-surface-variant/80">
                        {result.schemaErrors.output.map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {result.output !== undefined && (
                    <details className="mt-2">
                      <summary className="font-label text-[9px] uppercase tracking-[0.2em] cursor-pointer">
                        raw output
                      </summary>
                      <pre className="mt-1 font-mono text-[10px] whitespace-pre-wrap break-all max-h-40 overflow-auto">
                        {JSON.stringify(result.output, null, 2)}
                      </pre>
                    </details>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    portal,
  );
}
