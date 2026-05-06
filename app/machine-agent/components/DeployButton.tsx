"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { AgentRow } from "../types";

export default function DeployButton({ agent, isAdmin }: { agent: AgentRow; isAdmin: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const isMech = agent.mode === "MECHANICAL";
  const accent = isMech ? "secondary" : "primary";
  const accentText = isMech ? "text-secondary" : "text-primary";
  const accentBorder = isMech ? "border-secondary" : "border-primary";
  const accentBg = isMech ? "bg-secondary/15" : "bg-primary/15";
  const accentHover = isMech ? "hover:bg-secondary/25" : "hover:bg-primary/25";
  const accentGlow = isMech
    ? "shadow-[0_0_18px_rgba(233,193,118,0.45)]"
    : "shadow-[0_0_18px_rgba(144,222,205,0.45)]";

  async function deploy() {
    setBusy(true);
    setToast(null);
    try {
      const r = await fetch(`/api/agents/${agent.id}/deploy`, { method: "POST" });
      if (!r.ok) {
        setToast(t.machineAgent.deployFailed);
        return;
      }
      setToast(t.machineAgent.deploySuccess);
      router.refresh();
      setTimeout(() => setToast(null), 3500);
    } catch (e) {
      console.error("[DeployButton] failed", e);
      setToast(t.machineAgent.deployFailed);
    } finally {
      setBusy(false);
    }
  }

  const label = busy
    ? t.machineAgent.deploying
    : agent.deployedAt
      ? t.machineAgent.redeploy
      : t.machineAgent.deploy;

  return (
    <div className="shrink-0 relative">
      {toast ? (
        <span
          role="status"
          className={`absolute right-0 top-full mt-1 z-20 whitespace-nowrap font-label text-[9px] tracking-[0.25em] uppercase px-2.5 py-1 rounded border ${accentBorder}/40 ${accentText} bg-background/90 ${accentGlow}`}
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
    </div>
  );
}
