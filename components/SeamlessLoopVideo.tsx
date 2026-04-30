"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  poster?: string;
  className?: string;
  style?: CSSProperties;
  fadeWindow?: number;
};

type NetworkConnection = {
  saveData?: boolean;
  effectiveType?: string;
};

function shouldDowngrade(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as Navigator & { connection?: NetworkConnection })
    .connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  return conn.effectiveType === "slow-2g" || conn.effectiveType === "2g" || conn.effectiveType === "3g";
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function SeamlessLoopVideo({
  src,
  poster,
  className,
  style,
  fadeWindow = 0.6,
}: Props) {
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  const [front, setFront] = useState<"a" | "b">("a");
  const [downgrade, setDowngrade] = useState(false);

  useEffect(() => {
    const next = shouldDowngrade() || prefersReducedMotion();
    if (!next) return;
    const frame = window.requestAnimationFrame(() => {
      setDowngrade(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (downgrade) return;
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;

    let active: HTMLVideoElement = a;
    let standby: HTMLVideoElement = b;
    let armed = true;

    const onTime = () => {
      if (!active.duration || !isFinite(active.duration)) return;
      const remaining = active.duration - active.currentTime;
      if (armed && remaining <= fadeWindow) {
        armed = false;
        standby.currentTime = 0;
        standby.play().catch(() => { });
        setFront(standby === a ? "a" : "b");
        const t = standby;
        standby = active;
        active = t;
        window.setTimeout(() => {
          armed = true;
        }, fadeWindow * 1000 + 50);
      }
    };

    a.addEventListener("timeupdate", onTime);
    b.addEventListener("timeupdate", onTime);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      b.removeEventListener("timeupdate", onTime);
    };
  }, [fadeWindow, downgrade]);

  const baseStyle: CSSProperties = {
    transition: `opacity ${fadeWindow}s linear`,
    ...style,
  };

  if (downgrade) {
    return (
      <div
        aria-hidden="true"
        className={className}
        style={{
          ...style,
          backgroundImage: poster ? `url(${poster})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundColor: poster ? undefined : "rgba(8,18,18,0.85)",
        }}
      />
    );
  }

  return (
    <>
      <video
        ref={aRef}
        src={src}
        autoPlay
        muted
        playsInline
        loop
        preload="auto"
        poster={poster}
        aria-hidden="true"
        className={className}
        style={{ ...baseStyle, opacity: front === "a" ? 1 : 0 }}
      />
      <video
        ref={bRef}
        src={src}
        muted
        playsInline
        loop
        preload="auto"
        poster={poster}
        aria-hidden="true"
        className={className}
        style={{ ...baseStyle, opacity: front === "b" ? 1 : 0 }}
      />
    </>
  );
}
