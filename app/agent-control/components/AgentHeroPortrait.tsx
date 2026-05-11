"use client";

import { useT } from "@/lib/i18n/client";
import type { AgentRow } from "../types";
import { themeClass } from "@/lib/agentControl/theme";

export default function AgentHeroPortrait({ agent }: { agent: AgentRow }) {
  const t = useT();
  const tintClass = themeClass(agent.mode, "tintFrom15");
  const accentText = themeClass(agent.mode, "text");
  const accentBorder = themeClass(agent.mode, "borderSoft");
  const accentMarker = themeClass(agent.mode, "marker");

  return (
    <div
      className={[
        "relative h-full w-full rounded-md border bg-background/50 p-1.5",
        accentBorder,
      ].join(" ")}
    >
      <div
        className={[
          "absolute -top-2 left-3 px-2 leading-none font-label text-[10px] tracking-[0.3em] uppercase bg-background",
          accentText,
        ].join(" ")}
      >
        {t.agentControl.heroPortrait}
      </div>
      <span
        aria-hidden
        className={[
          "absolute top-0 right-0 w-3 h-3 pointer-events-none",
          "before:content-[''] before:absolute before:top-0 before:right-0 before:h-px before:w-full",
          "after:content-[''] after:absolute after:top-0 after:right-0 after:w-px after:h-full",
          accentMarker,
        ].join(" ")}
      />
      <span
        aria-hidden
        className={[
          "absolute bottom-0 left-0 w-3 h-3 pointer-events-none",
          "before:content-[''] before:absolute before:bottom-0 before:left-0 before:h-px before:w-full",
          "after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-px after:h-full",
          accentMarker,
        ].join(" ")}
      />

      <div className="relative h-full w-full rounded overflow-hidden bg-surface-container-lowest">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={agent.avatarUrl}
          alt={agent.codename}
          loading="eager"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div
          aria-hidden
          className={`absolute inset-0 pointer-events-none bg-gradient-to-t ${tintClass} via-transparent to-background/40 mix-blend-screen`}
        />
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1/3 pointer-events-none bg-gradient-to-t from-background/80 to-transparent"
        />
        <div aria-hidden className="absolute inset-0 pointer-events-none scanline-overlay opacity-50" />
      </div>
    </div>
  );
}
