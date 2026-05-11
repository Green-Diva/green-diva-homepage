// Mode-driven theme tokens for /agent-control. Single source of truth for the
// "MECHANICAL = gold (secondary) / AUTONOMOUS = teal (primary)" palette.
//
// Tailwind cannot resolve dynamic class names (e.g. `text-${accent}`), so every
// value returned here is a complete literal string — PostCSS purge stays happy.
// Callers pass the agent mode plus a semantic slot name; this module owns the
// pairing.

import type { AgentMode } from "@/app/agent-control/types";

export const MECH_RGBA = {
  strong: "rgba(233,193,118,0.7)",
  medium: "rgba(233,193,118,0.55)",
  soft: "rgba(233,193,118,0.45)",
} as const;

export const AGENT_RGBA = {
  strong: "rgba(144,222,205,0.7)",
  medium: "rgba(144,222,205,0.55)",
  soft: "rgba(144,222,205,0.45)",
} as const;

export const MECH_HEX = "#E9C176";
export const AGENT_HEX = "#90DECD";

export function themeHex(mode: AgentMode): string {
  return mode === "MECHANICAL" ? MECH_HEX : AGENT_HEX;
}

export type RgbaIntensity = keyof typeof MECH_RGBA;

export function themeRgba(mode: AgentMode, intensity: RgbaIntensity = "strong"): string {
  return (mode === "MECHANICAL" ? MECH_RGBA : AGENT_RGBA)[intensity];
}

const MECH_CLASSES = {
  text: "text-secondary",
  textSoft: "text-secondary/70",
  bg: "bg-secondary",
  bgSoft: "bg-secondary/15",
  border: "border-secondary",
  borderSoft: "border-secondary/25",
  borderMedium: "border-secondary/40",
  ring: "border-secondary text-secondary",
  marker: "before:bg-secondary/70 after:bg-secondary/70",
  hover: "hover:bg-secondary/25",
  glow: "shadow-[0_0_18px_rgba(233,193,118,0.45)]",
  ringEmpty: "border-secondary/35 hover:border-secondary/70 text-secondary/60",
  badgeSoft: "bg-secondary/20 text-secondary",
  fill: "bg-secondary/[0.12]",
  fillHover: "hover:bg-secondary/[0.20]",
  bgSofter: "bg-secondary/10",
  hoverSofter: "hover:bg-secondary/20",
  inputAccent: "accent-secondary",
  modeBadge: "border-secondary/60 text-secondary bg-secondary/[0.10]",
  tintFrom15: "from-secondary/15",
  tintFrom20: "from-secondary/20",
  btnAccent: "border-secondary/70 text-secondary hover:bg-secondary/[0.12]",
  chipActive: "border-secondary/70 text-secondary bg-secondary/[0.12] shadow-[0_0_12px_rgba(233,193,118,0.25)]",
} as const;

const AGENT_CLASSES: Record<keyof typeof MECH_CLASSES, string> = {
  text: "text-primary",
  textSoft: "text-primary/70",
  bg: "bg-primary",
  bgSoft: "bg-primary/15",
  border: "border-primary",
  borderSoft: "border-primary/25",
  borderMedium: "border-primary/40",
  ring: "border-primary text-primary",
  marker: "before:bg-primary/70 after:bg-primary/70",
  hover: "hover:bg-primary/25",
  glow: "shadow-[0_0_18px_rgba(144,222,205,0.45)]",
  ringEmpty: "border-primary/35 hover:border-primary/70 text-primary/60",
  badgeSoft: "bg-primary/20 text-primary",
  fill: "bg-primary/[0.12]",
  fillHover: "hover:bg-primary/[0.20]",
  bgSofter: "bg-primary/10",
  hoverSofter: "hover:bg-primary/20",
  inputAccent: "accent-primary",
  modeBadge: "border-primary/60 text-primary bg-primary/[0.10]",
  tintFrom15: "from-primary/15",
  tintFrom20: "from-primary/20",
  btnAccent: "border-primary/70 text-primary hover:bg-primary/[0.12]",
  chipActive: "border-primary/70 text-primary bg-primary/[0.12] shadow-[0_0_12px_rgba(144,222,205,0.25)]",
};

export type ThemeSlot = keyof typeof MECH_CLASSES;

export function themeClass(mode: AgentMode, slot: ThemeSlot): string {
  return (mode === "MECHANICAL" ? MECH_CLASSES : AGENT_CLASSES)[slot];
}

export function themeClasses<K extends ThemeSlot>(
  mode: AgentMode,
  slots: readonly K[],
): Record<K, string> {
  const src = mode === "MECHANICAL" ? MECH_CLASSES : AGENT_CLASSES;
  return Object.fromEntries(slots.map((k) => [k, src[k]])) as Record<K, string>;
}

export function themeAccent(mode: AgentMode): "secondary" | "primary" {
  return mode === "MECHANICAL" ? "secondary" : "primary";
}
