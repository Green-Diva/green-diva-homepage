"use client";

import Image from "next/image";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";

type Props = {
  src: string;
};

export default function HeroPortrait({ src }: Props) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);

  const trigger = () => setRevealed(true);

  return (
    <div
      onMouseEnter={trigger}
      onTouchStart={trigger}
      className="group relative w-full max-w-[420px] aspect-[4/5] lg:max-w-none lg:aspect-auto lg:h-full lg:min-h-[400px] overflow-hidden rounded-xl border border-primary/20 hover:border-primary/40 shadow-[0_0_40px_rgba(144,222,205,0.05)] hover:shadow-[0_0_60px_rgba(144,222,205,0.18)] transition-[border-color,box-shadow] duration-[1000ms] ease-out bg-background"
    >
      {/* Base grayscale layer */}
      <Image
        alt={t.hero.portraitAlt}
        src={src}
        fill
        priority
        sizes="(max-width: 1024px) 100vw, 25vw"
        className="object-cover grayscale brightness-90 contrast-[1.05]"
      />
      {/* Color layer revealed via clip-path sweep on first hover */}
      <div
        aria-hidden
        className={
          revealed
            ? "absolute inset-0 portrait-reveal"
            : "absolute inset-0 opacity-0 [clip-path:inset(100%_0_0_0)]"
        }
      >
        <Image
          alt=""
          src={src}
          fill
          sizes="(max-width: 1024px) 100vw, 25vw"
          className="object-cover saturate-[0.78] brightness-95"
        />
      </div>
      {/* CRT scanlines — fade out once reveal completes */}
      <div
        aria-hidden
        className={`absolute inset-0 pointer-events-none bg-[repeating-linear-gradient(0deg,rgba(0,0,0,0.22)_0px,rgba(0,0,0,0.22)_1px,transparent_1px,transparent_3px)] mix-blend-multiply transition-opacity duration-[1800ms] ease-out ${
          revealed ? "opacity-0" : "opacity-50"
        }`}
      />
      {/* HUD targeting brackets */}
      <div aria-hidden className="absolute inset-3 pointer-events-none">
        <span className="absolute top-0 left-0 w-5 h-5 border-l border-t border-primary/60" />
        <span className="absolute top-0 right-0 w-5 h-5 border-r border-t border-primary/60" />
        <span className="absolute bottom-0 left-0 w-5 h-5 border-l border-b border-primary/60" />
        <span className="absolute bottom-0 right-0 w-5 h-5 border-r border-b border-primary/60" />
      </div>
      {/* NERV-style decoding bar (only during first reveal) */}
      {revealed ? (
        <>
          <div aria-hidden className="absolute inset-0 pointer-events-none portrait-scan-sweep" />
          <div aria-hidden className="absolute inset-0 pointer-events-none portrait-decode-flicker mix-blend-screen" />
        </>
      ) : (
        <div
          aria-hidden
          className="absolute top-3 left-5 right-5 flex items-center gap-2 pointer-events-none"
        >
          <span className="font-label text-[9px] text-primary/70 tracking-[0.4em] uppercase animate-pulse">
            STANDBY
          </span>
          <span className="flex-1 h-px bg-primary/30" />
          <span className="font-label text-[9px] text-primary/50 tracking-[0.3em]">A.T.</span>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
      <div className="absolute bottom-6 left-0 right-0 text-center z-10">
        <span className="font-label text-[11px] text-primary/70 tracking-[0.3em] uppercase">
          {t.hero.codename}
        </span>
      </div>
    </div>
  );
}
