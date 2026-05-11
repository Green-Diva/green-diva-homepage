"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { AgentRow } from "../types";
import { themeAccent, themeClass } from "@/lib/agentControl/theme";

type TakeoverEntry = {
  sceneKey: string;
  previousAgentId: string;
  previousAgentCodename: string;
  previouslyEnabled: boolean;
};

export default function DeployButton({ agent, isAdmin }: { agent: AgentRow; isAdmin: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // When deploy hits a conflict, server returns 409 + takeovers; we surface
  // them in a confirm modal and re-POST with confirmTakeovers=true on OK.
  const [confirmTakeovers, setConfirmTakeovers] = useState<TakeoverEntry[] | null>(null);

  const accent = themeAccent(agent.mode);
  const accentText = themeClass(agent.mode, "text");
  const accentBorder = themeClass(agent.mode, "border");
  const accentBg = themeClass(agent.mode, "bgSoft");
  const accentHover = themeClass(agent.mode, "hover");
  const accentGlow = themeClass(agent.mode, "glow");

  async function postDeploy(confirm: boolean) {
    return fetch(`/api/agents/${agent.id}/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(confirm ? { confirmTakeovers: true } : {}),
    });
  }

  async function deploy() {
    setBusy(true);
    setToast(null);
    try {
      const r = await postDeploy(false);
      if (r.status === 409) {
        const j = (await r.json().catch(() => ({}))) as {
          errorCode?: string;
          takeovers?: TakeoverEntry[];
        };
        if (j.errorCode === "TAKEOVER_CONFIRM_REQUIRED" && Array.isArray(j.takeovers)) {
          setConfirmTakeovers(j.takeovers);
          return;
        }
      }
      if (!r.ok) {
        setToast(t.agentControl.deployFailed);
        return;
      }
      setToast(t.agentControl.deploySuccess);
      router.refresh();
      setTimeout(() => setToast(null), 3500);
    } catch (e) {
      console.error("[DeployButton] failed", e);
      setToast(t.agentControl.deployFailed);
    } finally {
      setBusy(false);
    }
  }

  async function confirmAndDeploy() {
    setBusy(true);
    setConfirmTakeovers(null);
    try {
      const r = await postDeploy(true);
      if (!r.ok) {
        setToast(t.agentControl.deployFailed);
        return;
      }
      setToast(t.agentControl.deploySuccess);
      router.refresh();
      setTimeout(() => setToast(null), 3500);
    } catch (e) {
      console.error("[DeployButton] confirm failed", e);
      setToast(t.agentControl.deployFailed);
    } finally {
      setBusy(false);
    }
  }

  const label = busy
    ? t.agentControl.deploying
    : agent.deployedAt
      ? t.agentControl.redeploy
      : t.agentControl.deploy;

  return (
    <div className="shrink-0 relative">
      {toast ? (
        <span
          role="status"
          className={`absolute right-0 top-full mt-1 z-20 whitespace-nowrap font-label text-[9px] tracking-[0.25em] uppercase px-2.5 py-1 rounded border ${themeClass(agent.mode, "borderMedium")} ${accentText} bg-background/90 ${accentGlow}`}
        >
          {toast}
        </span>
      ) : null}
      <button
        type="button"
        disabled={!isAdmin || busy}
        onClick={deploy}
        className={[
          "min-h-[44px] px-6 rounded-md border-2 font-label text-[11px] tracking-[0.35em] uppercase transition-all flex items-center gap-2",
          accentBorder,
          accentText,
          accentBg,
          accentHover,
          accentGlow,
          "disabled:opacity-40 disabled:cursor-not-allowed",
        ].join(" ")}
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden>
          {agent.deployedAt ? "rocket_launch" : "rocket"}
        </span>
        {label}
      </button>
      <span aria-hidden className="sr-only">{accent}</span>
      {confirmTakeovers ? (
        <TakeoverConfirmModal
          takeovers={confirmTakeovers}
          accentText={accentText}
          accentBorder={accentBorder}
          accentBg={accentBg}
          onCancel={() => {
            setConfirmTakeovers(null);
            setBusy(false);
          }}
          onConfirm={confirmAndDeploy}
        />
      ) : null}
    </div>
  );
}

function TakeoverConfirmModal({
  takeovers,
  accentText,
  accentBorder,
  accentBg,
  onCancel,
  onConfirm,
}: {
  takeovers: TakeoverEntry[];
  accentText: string;
  accentBorder: string;
  accentBg: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-outline-variant/40 bg-surface-container p-6 shadow-2xl">
        <h2 className={`font-label text-[12px] tracking-[0.3em] uppercase mb-3 ${accentText}`}>
          {t.agentControl.deployTakeoverTitle}
        </h2>
        <p className="text-sm text-on-surface-variant mb-4 leading-relaxed">
          {t.agentControl.deployTakeoverBody}
        </p>
        <ul className="space-y-2 mb-6 max-h-[40vh] overflow-y-auto">
          {takeovers.map((tk) => (
            <li
              key={tk.sceneKey}
              className="rounded-md border border-amber-300/30 bg-amber-300/5 px-3 py-2"
            >
              <div className="font-mono text-[12px] text-on-surface">{tk.sceneKey}</div>
              <div className="text-[11px] text-amber-300/90 mt-0.5">
                {t.agentControl.deployTakeoverFromPrefix} <span className="font-mono">{tk.previousAgentCodename}</span>
                {tk.previouslyEnabled ? (
                  <span className="ml-1.5 text-[10px] tracking-[0.2em] uppercase text-rose-300/90 border border-rose-300/40 px-1 rounded">
                    {t.agentControl.deployTakeoverLiveBadge}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[40px] px-5 py-1.5 border border-outline-variant text-on-surface-variant font-label text-[10px] tracking-[0.3em] uppercase rounded-md hover:bg-surface-container/70 transition-colors"
          >
            {t.agentControl.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`min-h-[40px] px-5 py-1.5 border-2 font-label text-[10px] tracking-[0.3em] uppercase rounded-md transition-colors ${accentBorder} ${accentText} ${accentBg} hover:opacity-90`}
          >
            {t.agentControl.deployTakeoverConfirm}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
