"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  className?: string;
  style?: CSSProperties;
  fadeWindow?: number;
};

export default function SeamlessLoopVideo({
  src,
  className,
  style,
  fadeWindow = 0.6,
}: Props) {
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  const [front, setFront] = useState<"a" | "b">("a");

  useEffect(() => {
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
        standby.play().catch(() => {});
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
  }, [fadeWindow]);

  const baseStyle: CSSProperties = {
    transition: `opacity ${fadeWindow}s linear`,
    ...style,
  };

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
        aria-hidden="true"
        className={className}
        style={{ ...baseStyle, opacity: front === "b" ? 1 : 0 }}
      />
    </>
  );
}
