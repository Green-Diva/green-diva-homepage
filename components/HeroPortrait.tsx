"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";

type Props = {
  src: string;
};

export default function HeroPortrait({ src }: Props) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  const [hovering, setHovering] = useState(false);

  // never hovered: grayscale; hovering: full color; after-hover: slightly desaturated
  const filterClass = hovering
    ? "grayscale-0 saturate-100 brightness-100"
    : revealed
      ? "grayscale-0 saturate-[0.78] brightness-95"
      : "grayscale brightness-90";

  // corner halo only visible after first hover, when not currently hovering
  const haloVisible = revealed && !hovering;

  return (
    <div
      onMouseEnter={() => {
        setRevealed(true);
        setHovering(true);
      }}
      onMouseLeave={() => setHovering(false)}
      onTouchStart={() => {
        setRevealed(true);
        setHovering(true);
      }}
      onTouchEnd={() => setHovering(false)}
      className="group relative h-full aspect-[4/5] overflow-hidden rounded-xl border border-secondary/20 hover:border-secondary/40 shadow-[0_0_40px_rgba(233,193,118,0.05)] hover:shadow-[0_0_60px_rgba(233,193,118,0.15)] transition-[border-color,box-shadow] duration-[1000ms] ease-out"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={t.hero.portraitAlt}
        className={`w-full h-full object-cover transition-[filter] duration-[1000ms] ease-out ${filterClass}`}
        src={src}
      />
      {/* Corner color halos, visible only after first hover when idle */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 transition-opacity duration-[1000ms] ease-out ${
          haloVisible ? "opacity-100" : "opacity-0"
        }`}
        style={{
          backgroundImage: [
            "radial-gradient(circle at 0% 0%, rgba(144, 222, 205, 0.32), transparent 38%)",
            "radial-gradient(circle at 100% 0%, rgba(233, 193, 118, 0.32), transparent 38%)",
            "radial-gradient(circle at 100% 100%, rgba(144, 222, 205, 0.32), transparent 38%)",
            "radial-gradient(circle at 0% 100%, rgba(233, 193, 118, 0.32), transparent 38%)",
          ].join(", "),
          mixBlendMode: "screen",
        }}
      />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent opacity-100 group-hover:opacity-50 transition-opacity duration-[1000ms] ease-out pointer-events-none"></div>
      <div className="absolute bottom-6 left-0 right-0 text-center">
        <span className="font-label text-[11px] text-primary/50 group-hover:text-primary/80 tracking-[0.3em] uppercase transition-colors duration-[1000ms] ease-out">
          {t.hero.codename}
        </span>
      </div>
    </div>
  );
}
