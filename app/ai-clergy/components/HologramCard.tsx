"use client";

import type { ClericRow } from "../types";
import { useT } from "@/lib/i18n/client";

const STATUS_TEXT: Record<ClericRow["status"], { color: string; ring: string; key: "statusOnline" | "statusStandby" | "statusOffline" }> = {
  ONLINE: { color: "text-emerald-400 border-emerald-400/60 bg-emerald-400/[0.08]", ring: "bg-emerald-400 mv-status-dot", key: "statusOnline" },
  STANDBY: { color: "text-amber-200 border-amber-300/40 bg-amber-300/[0.08]", ring: "bg-amber-300", key: "statusStandby" },
  OFFLINE: { color: "text-rose-300 border-rose-400/40 bg-rose-400/[0.08]", ring: "bg-rose-400", key: "statusOffline" },
};

const MODE_BADGE: Record<ClericRow["mode"], { icon: string; color: string; key: "modeMechanical" | "modeAutonomous"; hintKey: "modeMechanicalHint" | "modeAutonomousHint" }> = {
  MECHANICAL: { icon: "precision_manufacturing", color: "text-secondary border-secondary/60 bg-secondary/[0.08]", key: "modeMechanical", hintKey: "modeMechanicalHint" },
  AUTONOMOUS: { icon: "hub", color: "text-primary border-primary/60 bg-primary/[0.08]", key: "modeAutonomous", hintKey: "modeAutonomousHint" },
};

export default function HologramCard({ cleric }: { cleric: ClericRow }) {
  const t = useT();
  const status = STATUS_TEXT[cleric.status];
  const mode = MODE_BADGE[cleric.mode ?? "MECHANICAL"];

  return (
    <div className="flex flex-col gap-4">
      <div className="relative w-full aspect-square rounded-md overflow-hidden border border-primary/30 bg-surface-container-lowest">
        {cleric.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cleric.avatarUrl}
            alt={cleric.codename}
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
          ID · {cleric.codename}
        </div>
        <span
          className={`absolute top-3 right-3 px-2 py-1 border rounded font-label text-[9px] tracking-[0.3em] uppercase flex items-center gap-1.5 ${mode.color}`}
          title={t.aiClergy[mode.hintKey]}
        >
          <span aria-hidden className="material-symbols-outlined text-[12px] leading-none">{mode.icon}</span>
          {t.aiClergy[mode.key]}
        </span>
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
          <div>
            <div className="font-label text-[10px] tracking-[0.3em] text-primary/60 uppercase">{t.aiClergy.classLabel}</div>
            <div className="font-headline text-2xl text-primary leading-tight sacred-glow">{cleric.codename}</div>
          </div>
          <span
            className={`px-2 py-1 border rounded font-label text-[9px] tracking-[0.3em] uppercase flex items-center gap-1.5 ${status.color}`}
          >
            <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${status.ring}`} />
            {t.aiClergy[status.key]}
          </span>
        </div>
      </div>

      <div>
        <div className="font-headline text-lg text-on-surface">{cleric.nameZh}</div>
        {cleric.classification ? (
          <div className="mt-1 font-label text-[9px] tracking-[0.3em] text-secondary uppercase">{cleric.classification}</div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="border-l-2 border-primary/40 pl-3">
          <div className="font-label text-[9px] tracking-[0.3em] text-on-surface-variant uppercase">
            {t.aiClergy.syncLevel}
          </div>
          <div className="mt-1 font-headline text-xl text-on-surface tabular-nums">{cleric.syncLevel.toFixed(1)}%</div>
        </div>
        <div className="border-l-2 border-primary/40 pl-3">
          <div className="font-label text-[9px] tracking-[0.3em] text-on-surface-variant uppercase">
            {t.aiClergy.matrixLevel}
          </div>
          <div className="mt-1 font-headline text-xl text-on-surface tabular-nums">LV.{cleric.matrixLevel}</div>
        </div>
      </div>
    </div>
  );
}
