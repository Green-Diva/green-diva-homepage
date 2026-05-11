"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { themeClass } from "@/lib/agentControl/theme";
import type { AgentMode } from "../types";

const ASPECT = 131 / 304; // matches hero portrait outer panel ratio (0.4309)

type Props = {
  src: string;
  isMech: boolean;
  onCancel: () => void;
  onApply: (blob: Blob) => void;
};

export default function AvatarCropModal({ src, isMech, onCancel, onApply }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  async function apply() {
    if (!croppedAreaPixels) return;
    setBusy(true);
    try {
      const blob = await cropToBlob(src, croppedAreaPixels);
      onApply(blob);
    } finally {
      setBusy(false);
    }
  }

  const mode: AgentMode = isMech ? "MECHANICAL" : "AUTONOMOUS";
  const applyCls = [
    "min-h-[44px] px-6 py-2 font-label text-[10px] tracking-[0.3em] uppercase rounded-md disabled:opacity-40 transition-colors border",
    themeClass(mode, "bgSofter"),
    themeClass(mode, "borderMedium"),
    themeClass(mode, "text"),
    themeClass(mode, "hoverSofter"),
  ].join(" ");

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop portrait"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md cyber-panel rounded-lg p-6 space-y-4">
        <h3 className={`font-headline text-2xl ${themeClass(mode, "text")}`}>
          Crop Portrait
        </h3>

        {/* Cropper area — keep aspect 131:304 */}
        <div className="relative w-full bg-black/60 rounded-md overflow-hidden" style={{ aspectRatio: "131 / 304", maxHeight: "60vh" }}>
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={ASPECT}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            objectFit="contain"
            showGrid={false}
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-base text-on-surface-variant" aria-hidden>zoom_out</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className={`flex-1 ${themeClass(mode, "inputAccent")}`}
            aria-label="zoom"
          />
          <span className="material-symbols-outlined text-base text-on-surface-variant" aria-hidden>zoom_in</span>
        </div>

        <p className="text-[11px] text-on-surface-variant/70">
          Drag to reposition · scroll or use slider to zoom
        </p>

        <div className="flex justify-end gap-3 pt-2 border-t border-outline-variant/30">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[44px] px-6 py-2 border border-outline-variant text-on-surface-variant font-label text-[10px] tracking-[0.3em] uppercase rounded-md hover:bg-surface-container transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={busy || !croppedAreaPixels}
            className={applyCls}
          >
            {busy ? "…" : "Apply"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

async function cropToBlob(imgSrc: string, area: Area): Promise<Blob> {
  const image = await loadImage(imgSrc);
  const canvas = document.createElement("canvas");
  canvas.width = area.width;
  canvas.height = area.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas ctx");
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      0.92,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
