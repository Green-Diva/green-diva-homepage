"use client";

import { useState } from "react";

type Props = {
  src: string;
};

export default function HeroPortrait({ src }: Props) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div
      onMouseEnter={() => setRevealed(true)}
      onTouchStart={() => setRevealed(true)}
      className="group relative h-full aspect-[4/5] overflow-hidden rounded-xl border border-secondary/20 hover:border-secondary/40 shadow-[0_0_40px_rgba(233,193,118,0.05)] hover:shadow-[0_0_60px_rgba(233,193,118,0.15)] transition-[border-color,box-shadow] duration-[1500ms] ease-out"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt="The Green Diva Portrait"
        className={`w-full h-full object-cover transition-[filter] duration-[1500ms] ease-out ${
          revealed ? "grayscale-0 brightness-100" : "grayscale brightness-90"
        }`}
        src={src}
      />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent opacity-100 group-hover:opacity-50 transition-opacity duration-[1500ms] ease-out pointer-events-none"></div>
      <div className="absolute bottom-6 left-0 right-0 text-center">
        <span className="font-label text-[11px] text-primary/50 group-hover:text-primary/80 tracking-[0.3em] uppercase transition-colors duration-[1500ms] ease-out">
          Codename · Diva-01
        </span>
      </div>
    </div>
  );
}
