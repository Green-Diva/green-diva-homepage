"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { AgentRow } from "../types";
import { themeAccent, themeClass } from "@/lib/agentControl/theme";

export default function DeployButton({ agent, isAdmin }: { agent: AgentRow; isAdmin: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const accent = themeAccent(agent.mode);
  const accentText = themeClass(agent.mode, "text");
  const accentBorder = themeClass(agent.mode, "border");
  const accentBg = themeClass(agent.mode, "bgSoft");
  const accentHover = themeClass(agent.mode, "hover");
  const accentGlow = themeClass(agent.mode, "glow");

  async function deploy() {
    setBusy(true);
    setToast(null);
    try {
      const r = await fetch(`/api/agents/${agent.id}/deploy`, { method: "POST" });
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
    </div>
  );
}
