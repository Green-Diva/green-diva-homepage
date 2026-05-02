"use client";

import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/types";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          alt?: string;
          "camera-controls"?: boolean | "";
          "auto-rotate"?: boolean | "";
          "rotation-per-second"?: string;
          exposure?: string;
          "shadow-intensity"?: string;
          "shadow-softness"?: string;
          "interaction-prompt"?: string;
          loading?: "auto" | "lazy" | "eager";
          reveal?: "auto" | "interaction" | "manual";
          "environment-image"?: string;
        },
        HTMLElement
      >;
    }
  }
}

type Props = {
  modelUrl: string;
  alt: string;
  t: Dictionary;
};

export default function RelicViewer({ modelUrl, alt, t }: Props) {
  const [ready, setReady] = useState(false);
  const [errored, setErrored] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduceMotion(m.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    import("@google/model-viewer")
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err) => {
        console.error("[RelicViewer] failed to load model-viewer", err);
        if (!cancelled) setErrored(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (errored) {
    return (
      <div className="aspect-square w-full bg-surface-container/40 border border-error/30 flex items-center justify-center lg:aspect-auto lg:h-full lg:max-h-full lg:flex-1">
        <span className="font-label text-[11px] tracking-[0.2em] uppercase text-error">
          {t.relicCollection.viewerUnsupported}
        </span>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="relative aspect-square w-full bg-surface-container/40 border border-primary/30 overflow-hidden flex items-center justify-center lg:aspect-auto lg:h-full lg:max-h-full lg:flex-1">
        <span className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/15 to-transparent animate-[scan_2.4s_linear_infinite]" />
        <span className="font-label text-[11px] tracking-[0.3em] uppercase text-primary z-10">
          {t.relicCollection.viewerLoading}
        </span>
      </div>
    );
  }

  return (
    <div className="aspect-square w-full bg-surface-container/40 border border-primary/30 relative overflow-hidden lg:aspect-auto lg:h-full lg:max-h-full lg:flex-1">
      <span className="pointer-events-none absolute top-0 left-0 w-3 h-3 border-l border-t border-primary/70 z-10" />
      <span className="pointer-events-none absolute top-0 right-0 w-3 h-3 border-r border-t border-primary/70 z-10" />
      <span className="pointer-events-none absolute bottom-0 left-0 w-3 h-3 border-l border-b border-primary/70 z-10" />
      <span className="pointer-events-none absolute bottom-0 right-0 w-3 h-3 border-r border-b border-primary/70 z-10" />
      <ModelViewerElement
        modelUrl={modelUrl}
        alt={alt}
        autoRotate={!reduceMotion}
      />
    </div>
  );
}

function ModelViewerElement({
  modelUrl,
  alt,
  autoRotate,
}: {
  modelUrl: string;
  alt: string;
  autoRotate: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const host = ref.current;
    host.innerHTML = "";
    const el = document.createElement("model-viewer");
    el.setAttribute("src", modelUrl);
    el.setAttribute("alt", alt);
    el.setAttribute("camera-controls", "");
    if (autoRotate) {
      el.setAttribute("auto-rotate", "");
      el.setAttribute("rotation-per-second", "20deg");
    }
    el.setAttribute("exposure", "0.95");
    el.setAttribute("shadow-intensity", "1.1");
    el.setAttribute("shadow-softness", "0.6");
    el.setAttribute("interaction-prompt", "none");
    el.setAttribute("loading", "eager");
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.backgroundColor = "transparent";
    host.appendChild(el);
    return () => {
      host.innerHTML = "";
    };
  }, [modelUrl, alt, autoRotate]);
  return <div ref={ref} className="w-full h-full" />;
}
