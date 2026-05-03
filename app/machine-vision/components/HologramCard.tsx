"use client";

import type { AgentRow } from "../types";
import { useT } from "@/lib/i18n/client";

const STATUS_TEXT: Record<AgentRow["status"], { color: string; ring: string; key: "statusOnline" | "statusStandby" | "statusOffline" }> = {
  ONLINE: { color: "text-secondary border-secondary/60 bg-secondary/[0.08]", ring: "bg-secondary mv-status-dot", key: "statusOnline" },
  STANDBY: { color: "text-amber-200 border-amber-300/40 bg-amber-300/[0.08]", ring: "bg-amber-300", key: "statusStandby" },
  OFFLINE: { color: "text-rose-300 border-rose-400/40 bg-rose-400/[0.08]", ring: "bg-rose-400", key: "statusOffline" },
};

export default function HologramCard({ agent }: { agent: AgentRow }) {
  const t = useT();
  const status = STATUS_TEXT[agent.status];

  return (
    <div className="flex flex-col gap-4">
      <div className="relative w-full aspect-square rounded-md overflow-hidden border border-primary/30 bg-surface-container-lowest">
        {agent.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={agent.avatarUrl}
            alt={agent.codename}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover mix-blend-screen opacity-90"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="material-symbols-outlined text-primary/30 text-[120px]" aria-hidden>
              precision_manufacturing
            </span>
          </div>
        )}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
        <div aria-hidden className="absolute inset-0 scanline-overlay opacity-100" />
        <div className="absolute top-3 left-3 font-label text-[9px] tracking-[0.3em] text-primary/70 uppercase">
          ID · {agent.codename}
        </div>
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
          <div>
            <div className="font-label text-[10px] tracking-[0.3em] text-primary/60 uppercase">{t.machineVision.classLabel}</div>
            <div className="font-headline text-2xl text-primary leading-tight sacred-glow">{agent.codename}</div>
          </div>
          <span
            className={`px-2 py-1 border rounded font-label text-[9px] tracking-[0.3em] uppercase flex items-center gap-1.5 ${status.color}`}
          >
            <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${status.ring}`} />
            {t.machineVision[status.key]}
          </span>
        </div>
      </div>

      <div>
        <div className="font-headline text-lg text-on-surface">{agent.nameZh}</div>
        {agent.classification ? (
          <div className="mt-1 font-label text-[9px] tracking-[0.3em] text-secondary uppercase">{agent.classification}</div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="border-l-2 border-primary/40 pl-3">
          <div className="font-label text-[9px] tracking-[0.3em] text-on-surface-variant uppercase">
            {t.machineVision.syncLevel}
          </div>
          <div className="mt-1 font-headline text-xl text-on-surface tabular-nums">{agent.syncLevel.toFixed(1)}%</div>
        </div>
        <div className="border-l-2 border-primary/40 pl-3">
          <div className="font-label text-[9px] tracking-[0.3em] text-on-surface-variant uppercase">
            {t.machineVision.matrixLevel}
          </div>
          <div className="mt-1 font-headline text-xl text-on-surface tabular-nums">LV.{agent.matrixLevel}</div>
        </div>
      </div>
    </div>
  );
}
