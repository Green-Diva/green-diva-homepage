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
      <span className="font-label text-[11px] tracking-[0.2em] uppercase text-error">
        {t.relicCollection.viewerUnsupported}
      </span>
    );
  }

  if (!ready) {
    return (
      <span className="font-label text-[11px] tracking-[0.3em] uppercase text-primary">
        {t.relicCollection.viewerLoading}
      </span>
    );
  }

  return (
    <div className="w-full h-full">
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
    // Tight framing — camera fits the model's bounding box snugly. Combined
    // with the narrow FOV below, the displayed object size matches the 2D
    // enhanced cutout (edges flush with canvas). Width auto-scales by aspect.
    el.setAttribute("bounds", "tight");
    el.setAttribute("field-of-view", "30deg");
    el.setAttribute("max-field-of-view", "30deg");
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.backgroundColor = "transparent";
    // No CSS scale — bounds=tight already fits the model to the container;
    // upscaling would magnify the source. If a model's bbox ever exceeds the
    // viewport, bounds=tight clamps it down, so the "shrink-to-fit" case is
    // handled by model-viewer itself.
    host.appendChild(el);
    return () => {
      host.innerHTML = "";
    };
  }, [modelUrl, alt, autoRotate]);
  return <div ref={ref} className="w-full h-full" />;
}
