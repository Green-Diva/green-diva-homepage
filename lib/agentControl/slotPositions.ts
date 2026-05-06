// Coordinates for the 6 skill slots + 1 central control slot, expressed as
// percentages of the loadout container's bounding box. The container itself
// is `relative` with a fixed `aspect-ratio` matching the underlying spine /
// brain background image, so percentages stay aligned at any zoom.
//
// These constants live in their own file because they will need tweaking
// once real spine.jpg / brain.jpg art is dropped in. A future iteration may
// have admins upload an image and auto-extract slot anchors — at that point
// `getSlotPositions(mode, backgroundUrl)` would read from DB instead of
// returning these built-ins. Keep the function signature stable.

import type { SkillSlotIndex } from "@/lib/agentTypes";

export type SlotPos = {
  i: SkillSlotIndex;
  top: string;
  left: string;
};

export type CentralPos = { top: string; left: string };

// Spine layout: two vertical columns flanking the spine, 3 slots each,
// vertically aligned. CONTROL sits in the bright central column.
export const MACHINE_SLOTS: SlotPos[] = [
  { i: 0, top: "18%", left: "18%" },
  { i: 1, top: "18%", left: "82%" },
  { i: 2, top: "50%", left: "18%" },
  { i: 3, top: "50%", left: "82%" },
  { i: 4, top: "82%", left: "18%" },
  { i: 5, top: "82%", left: "82%" },
];
export const MACHINE_CENTRAL: CentralPos = { top: "50%", left: "50%" };

// Brain layout: 6 slots arranged on a circular arc around the cortex.
// Angles measured from straight up (0°) going clockwise.
// The arc skips the bottom 90° so slots cluster around the cortex top.
const ARC_CENTER_X = 50;
const ARC_CENTER_Y = 48;
const ARC_RADIUS = 30; // % of the container's smaller dimension
const arcAngles = [-110, -75, -40, 40, 75, 110];

export const AGENT_SLOTS: SlotPos[] = arcAngles.map((deg, idx) => {
  const rad = (deg * Math.PI) / 180;
  const left = ARC_CENTER_X + Math.sin(rad) * ARC_RADIUS;
  const top = ARC_CENTER_Y - Math.cos(rad) * ARC_RADIUS;
  return {
    i: idx as SkillSlotIndex,
    top: `${top.toFixed(2)}%`,
    left: `${left.toFixed(2)}%`,
  };
});

export const AGENT_CENTRAL: CentralPos = { top: "55%", left: "50%" };

export type LoadoutLayout = {
  slots: SlotPos[];
  central: CentralPos;
  background: string;
  fallback: string;
};

export function getLoadoutLayout(mode: "MECHANICAL" | "AUTONOMOUS"): LoadoutLayout {
  return mode === "MECHANICAL"
    ? {
        slots: MACHINE_SLOTS,
        central: MACHINE_CENTRAL,
        background: "/images/agent-control/spine.jpg",
        fallback: "/images/agent-control/spine.svg",
      }
    : {
        slots: AGENT_SLOTS,
        central: AGENT_CENTRAL,
        background: "/images/agent-control/brain.jpg",
        fallback: "/images/agent-control/brain.svg",
      };
}
