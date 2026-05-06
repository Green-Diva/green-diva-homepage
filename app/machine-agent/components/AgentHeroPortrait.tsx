"use client";

import type { AgentRow } from "../types";

// Vertical 2:3 poster portrait. Width is derived from height via aspect-ratio
// so it fits naturally as the leftmost column of an equal-height flex row.
export default function AgentHeroPortrait({ agent }: { agent: AgentRow }) {
  const isMech = agent.mode === "MECHANICAL";
  const borderClass = isMech ? "border-secondary/60" : "border-primary/60";
  const tintClass = isMech ? "from-secondary/15" : "from-primary/15";
  const accentText = isMech ? "text-secondary" : "text-primary";
  const glow = isMech
    ? "shadow-[0_0_22px_rgba(233,193,118,0.25)]"
    : "shadow-[0_0_22px_rgba(144,222,205,0.25)]";

  return (
    <div
      className={[
        "relative h-full aspect-[2/3] shrink-0 rounded-md overflow-hidden border bg-surface-container-lowest",
        borderClass,
        glow,
      ].join(" ")}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={agent.avatarUrl}
        alt={agent.codename}
        loading="eager"
        decoding="async"
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* Mode-coloured tint */}
      <div
        aria-hidden
        className={`absolute inset-0 pointer-events-none bg-gradient-to-t ${tintClass} via-transparent to-background/40 mix-blend-screen`}
      />
      {/* Bottom black fade for text contrast on future overlays */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-1/3 pointer-events-none bg-gradient-to-t from-background/80 to-transparent"
      />
      {/* Scanline overlay */}
      <div aria-hidden className="absolute inset-0 pointer-events-none scanline-overlay opacity-50" />

      {/* Top-left codename tag (kept understated; full info lives in DetailHeader above) */}
      <div className={`absolute top-2 left-2 font-label text-[9px] tracking-[0.3em] uppercase ${accentText} pointer-events-none`}>
        ID · {agent.codename}
      </div>
    </div>
  );
}
