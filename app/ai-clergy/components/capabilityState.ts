import type {
  CapabilitySummary,
  ClericCapabilityAutonomy,
} from "@/lib/clerics/capabilityTypes";

/**
 * Single source of truth for capability runtime status, used by both
 * SkillProgressionRail (top) and CapabilityList (bottom) so the two panels
 * always agree on green vs yellow.
 *
 * ready  = env configured AND (no calls yet OR last call succeeded)
 * warning = env missing OR last call failed
 */
export type CapabilityState = "ready" | "warning";

export function statusOf(cap: CapabilitySummary): CapabilityState {
  if (!cap.envOk) return "warning";
  if (cap.stats.last?.ok === false) return "warning";
  return "ready";
}

export const STATE_TOKENS = {
  ready: {
    text: "text-emerald-400",
    border: "border-emerald-400/60",
    borderSoft: "border-emerald-400/30",
    bgTint: "bg-emerald-400/[0.06]",
    bgTintSoft: "bg-emerald-400/[0.03]",
    led: "bg-emerald-400 shadow-[0_0_4px_currentColor] text-emerald-400",
    edge: "bg-emerald-400/80 shadow-[0_0_6px_rgba(52,211,153,0.5)]",
  },
  warning: {
    text: "text-amber-300",
    border: "border-amber-300/60",
    borderSoft: "border-amber-300/30",
    bgTint: "bg-amber-300/[0.08]",
    bgTintSoft: "bg-amber-300/[0.04]",
    led: "bg-amber-300 shadow-[0_0_4px_currentColor] text-amber-300",
    edge: "bg-amber-300/80 shadow-[0_0_6px_rgba(252,211,77,0.5)]",
  },
} as const;

/**
 * Rarity-grade level palette mirroring Relic Collection (VaultCell.tsx):
 *   L0 / COMMON     → on-surface-variant (off-white)
 *   L1 / RARE       → #80c8ff (blue)
 *   L2 / EPIC       → #c79bff (purple)
 *   L3 / LEGENDARY  → secondary (gold) + soft glow
 *
 * Each level's tokens drive a capability's whole visual identity (left strip,
 * icon, border tint, bg, LED, chip). Status colour (green/yellow) is reserved
 * for the rail's progression line and the Configure-key button when missing.
 */
export const LEVEL_TOKENS: Record<
  ClericCapabilityAutonomy,
  {
    text: string;
    border: string;
    borderSoft: string;
    bgTint: string;
    bgTintSoft: string;
    led: string;
    edge: string;
    chip: string;
  }
> = {
  0: {
    text: "text-on-surface-variant",
    border: "border-on-surface-variant/60",
    borderSoft: "border-on-surface-variant/25",
    bgTint: "bg-on-surface-variant/[0.06]",
    bgTintSoft: "bg-on-surface-variant/[0.025]",
    led: "bg-on-surface-variant shadow-[0_0_3px_currentColor] text-on-surface-variant",
    edge: "bg-on-surface-variant/70",
    chip: "border-on-surface-variant/40 text-on-surface-variant",
  },
  1: {
    text: "text-[#80c8ff]",
    border: "border-[#80c8ff]/60",
    borderSoft: "border-[#80c8ff]/25",
    bgTint: "bg-[#80c8ff]/[0.06]",
    bgTintSoft: "bg-[#80c8ff]/[0.025]",
    led: "bg-[#80c8ff] shadow-[0_0_4px_currentColor] text-[#80c8ff]",
    edge: "bg-[#80c8ff]/80 shadow-[0_0_6px_rgba(128,200,255,0.4)]",
    chip: "border-[#80c8ff]/50 text-[#80c8ff]",
  },
  2: {
    text: "text-[#c79bff]",
    border: "border-[#c79bff]/60",
    borderSoft: "border-[#c79bff]/25",
    bgTint: "bg-[#c79bff]/[0.07]",
    bgTintSoft: "bg-[#c79bff]/[0.03]",
    led: "bg-[#c79bff] shadow-[0_0_5px_currentColor] text-[#c79bff]",
    edge: "bg-[#c79bff]/80 shadow-[0_0_8px_rgba(199,155,255,0.5)]",
    chip: "border-[#c79bff]/50 text-[#c79bff] bg-[#c79bff]/[0.04]",
  },
  3: {
    text: "text-secondary",
    border: "border-secondary/70",
    borderSoft: "border-secondary/30",
    bgTint: "bg-secondary/[0.08]",
    bgTintSoft: "bg-secondary/[0.035]",
    led: "bg-secondary shadow-[0_0_6px_currentColor] text-secondary",
    edge: "bg-secondary shadow-[0_0_10px_rgba(255,219,60,0.6)]",
    chip: "border-secondary/70 text-secondary bg-secondary/[0.06] shadow-[0_0_6px_rgba(255,219,60,0.25)]",
  },
};
