"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { AgentRow } from "../types";

type Props = {
  agent: AgentRow;
  onClose: () => void;
};

export default function ControlConfigModal({ agent, onClose }: Props) {
  const t = useT();
  const router = useRouter();
  const isMech = agent.mode === "MECHANICAL";

  const initial = useMemo(() => {
    const cfg = isMech ? agent.pipelineConfig : agent.dispatcherConfig;
    return cfg ? JSON.stringify(cfg, null, 2) : "";
  }, [agent.pipelineConfig, agent.dispatcherConfig, isMech]);

  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const portal = useMemo(() => (typeof document !== "undefined" ? document.body : null), []);
  if (!portal) return null;

  async function save() {
    setBusy(true);
    setErr(null);
    let parsed: unknown = null;
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("expected object");
        }
      } catch {
        setBusy(false);
        setErr(t.agentControl.controlConfigInvalid);
        return;
      }
    }
    const url = isMech
      ? `/api/agents/${agent.id}/pipeline`
      : `/api/agents/${agent.id}/dispatcher`;
    try {
      const r = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: parsed }),
      });
      setBusy(false);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(typeof j.error === "string" ? j.error : "save failed");
        return;
      }
      router.refresh();
      onClose();
    } catch (e) {
      setBusy(false);
      setErr(e instanceof Error ? e.message : "save failed");
    }
  }

  const accent = isMech ? "text-secondary" : "text-primary";
  const title = isMech ? t.agentControl.pipelineConfigTitle : t.agentControl.dispatcherConfigTitle;
  const placeholder = isMech ? t.agentControl.pipelineConfigPlaceholder : t.agentControl.dispatcherConfigPlaceholder;
  const pendingHint = isMech ? t.agentControl.pipelineConfigPending : t.agentControl.dispatcherConfigPending;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[110] flex items-stretch justify-center bg-black/85 backdrop-blur-sm overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-3xl my-6 mx-4">
        <div className="cyber-panel rounded-lg p-6 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className={`font-label text-[10px] tracking-[0.3em] uppercase ${accent}`}>
                {agent.codename} · {isMech ? "Backbone Config" : "Orchestrator Config"}
              </p>
              <h2 className="mt-1 font-headline text-2xl text-on-surface sacred-glow">{title}</h2>
              <p className="mt-1 text-xs text-on-surface-variant">{pendingHint}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-on-surface-variant hover:text-on-surface"
              aria-label={t.agentControl.cancel}
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <textarea
            className="w-full min-h-[280px] rounded-md border border-primary/20 bg-surface-container px-3 py-2 text-xs font-mono text-on-surface focus:border-primary/60 focus:outline-none"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            spellCheck={false}
          />

          {err ? <p className="text-sm text-rose-300">{err}</p> : null}

          <div className="flex gap-2 pt-2 border-t border-outline-variant/30">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="min-h-[44px] px-6 bg-primary/10 border border-primary/40 text-primary font-label text-[10px] tracking-[0.3em] uppercase rounded-md hover:bg-primary/20 disabled:opacity-40 transition-colors"
            >
              {busy ? t.agentControl.controlConfigSaving : t.agentControl.controlConfigSave}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-6 border border-outline-variant text-on-surface-variant font-label text-[10px] tracking-[0.3em] uppercase rounded-md hover:bg-surface-container transition-colors"
            >
              {t.agentControl.cancel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    portal,
  );
}
