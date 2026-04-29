"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import SecretDoor, {
  SECRET_DOOR_LOCK_KEY,
} from "@/components/SecretDoor";

type Props = {
  src: string;
};

const CLICK_TARGET = 10;
const CLICK_RESET_MS = 4000;
const LONG_PRESS_MS = 10000;

export default function HeroPortrait({ src }: Props) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  const [doorOpen, setDoorOpen] = useState(false);
  const [pressProgress, setPressProgress] = useState(0);
  const clickCountRef = useRef(0);
  const clickResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStart = useRef<number>(0);
  const longPressRaf = useRef<number | null>(null);

  const trigger = () => setRevealed(true);

  const isLocked = () => {
    try {
      const v = sessionStorage.getItem(SECRET_DOOR_LOCK_KEY);
      if (!v) return false;
      const until = Number(v);
      if (Number.isNaN(until)) return false;
      if (Date.now() >= until) {
        sessionStorage.removeItem(SECRET_DOOR_LOCK_KEY);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  const clearClickReset = () => {
    if (clickResetTimer.current) {
      clearTimeout(clickResetTimer.current);
      clickResetTimer.current = null;
    }
  };

  const handleClick = () => {
    if (isLocked()) {
      clickCountRef.current = 0;
      clearClickReset();
      return;
    }
    clickCountRef.current += 1;
    clearClickReset();
    if (clickCountRef.current >= CLICK_TARGET) {
      clickCountRef.current = 0;
      setDoorOpen(true);
      return;
    }
    clickResetTimer.current = setTimeout(() => {
      clickCountRef.current = 0;
    }, CLICK_RESET_MS);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (longPressRaf.current) {
      cancelAnimationFrame(longPressRaf.current);
      longPressRaf.current = null;
    }
    setPressProgress(0);
  };

  const startLongPress = () => {
    if (isLocked()) return;
    cancelLongPress();
    longPressStart.current = Date.now();
    const tick = () => {
      const elapsed = Date.now() - longPressStart.current;
      const p = Math.min(1, elapsed / LONG_PRESS_MS);
      setPressProgress(p);
      if (p < 1) longPressRaf.current = requestAnimationFrame(tick);
    };
    longPressRaf.current = requestAnimationFrame(tick);
    longPressTimer.current = setTimeout(() => {
      setDoorOpen(true);
      cancelLongPress();
    }, LONG_PRESS_MS);
  };

  useEffect(() => {
    return () => {
      clearClickReset();
      cancelLongPress();
    };
  }, []);

  return (
    <>
    <div
      onMouseEnter={trigger}
      onClick={handleClick}
      onTouchStart={() => {
        trigger();
        startLongPress();
      }}
      onTouchEnd={cancelLongPress}
      onTouchCancel={cancelLongPress}
      onContextMenu={(e) => e.preventDefault()}
      style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
      className="group relative w-full max-w-[378px] aspect-[4/5] lg:max-w-none lg:aspect-auto lg:h-full lg:min-h-[360px] overflow-hidden rounded-xl border border-primary/20 hover:border-primary/40 shadow-[0_0_40px_rgba(144,222,205,0.05)] hover:shadow-[0_0_60px_rgba(144,222,205,0.18)] transition-[border-color,box-shadow] duration-[1000ms] ease-out bg-background select-none"
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
          className="object-cover saturate-[1.05] brightness-[0.98] contrast-[1.05]"
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
      {/* Long-press progress (mobile暗门提示) */}
      {pressProgress > 0.05 ? (
        <div
          aria-hidden
          className="absolute left-4 right-4 bottom-2 h-px bg-primary/15 z-10 overflow-hidden pointer-events-none"
        >
          <div
            className="h-full bg-primary/70 transition-[width] duration-75 ease-linear"
            style={{ width: `${pressProgress * 100}%` }}
          />
        </div>
      ) : null}
    </div>
    {doorOpen ? <SecretDoor onClose={() => setDoorOpen(false)} /> : null}
    </>
  );
}
