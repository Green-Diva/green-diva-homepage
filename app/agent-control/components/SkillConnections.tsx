"use client";

import type { AgentMode, EquipRow } from "../types";
import type { CentralPos, SlotPos } from "@/lib/agentControl/slotPositions";

// Connection state: skill equipped + ONLINE → mode accent color;
// equipped + OFFLINE → gray; empty slot → gray.
type ConnectionStatus = "online" | "offline" | "empty";

const STATUS_COLORS: Record<AgentMode, Record<ConnectionStatus, string>> = {
  MECHANICAL: {
    online: "#E9C176",
    offline: "rgba(180,180,180,0.45)",
    empty: "rgba(180,180,180,0.18)",
  },
  AUTONOMOUS: {
    online: "#90DECD",
    offline: "rgba(180,180,180,0.45)",
    empty: "rgba(180,180,180,0.18)",
  },
};

function parsePercent(v: string): number {
  return Number(v.replace("%", ""));
}

export default function SkillConnections({
  mode,
  slots,
  central,
  equips,
}: {
  mode: AgentMode;
  slots: SlotPos[];
  central: CentralPos;
  equips: EquipRow[];
}) {
  const slotted = new Map<number, EquipRow>();
  for (const e of equips) {
    if (typeof e.slotIndex === "number") slotted.set(e.slotIndex, e);
  }

  const cx = parsePercent(central.left);
  const cy = parsePercent(central.top);
  const palette = STATUS_COLORS[mode];

  return (
    <svg
      aria-hidden
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <defs>
        <filter
          id={`gd-conn-glow-${mode}`}
          filterUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="100"
          height="100"
        >
          <feGaussianBlur stdDeviation="0.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Column trunks: for each on-axis slot, draw vertical segments to its
          column neighbours so all 6 slots read as one connected harness. */}
      {slots
        .filter((p) => Math.abs(parsePercent(p.top) - cy) < 0.5)
        .flatMap((mid) => {
          const equip = slotted.get(mid.i) ?? null;
          const status: ConnectionStatus = !equip
            ? "empty"
            : equip.skill.status === "ONLINE"
              ? "online"
              : "offline";
          const color = palette[status];
          const mx = parsePercent(mid.left);
          const my = parsePercent(mid.top);
          const sameCol = slots.filter((p) => Math.abs(parsePercent(p.left) - mx) < 0.5 && p.i !== mid.i);
          return sameCol.map((peer) => {
            const py = parsePercent(peer.top);
            const path = `M ${mx} ${my} L ${mx} ${py}`;
            return (
              <g key={`trunk-${mid.i}-${peer.i}`}>
                <path
                  d={path}
                  fill="none"
                  stroke="rgba(0,0,0,0.55)"
                  strokeWidth={status === "online" ? 3 : 2.2}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={status === "online" ? 1.6 : 1}
                  strokeLinecap="round"
                  opacity={status === "online" ? 0.95 : 0.6}
                  filter={status === "online" ? `url(#gd-conn-glow-${mode})` : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          });
        })}
      {slots.map((pos) => {
        const equip = slotted.get(pos.i) ?? null;
        const status: ConnectionStatus = !equip
          ? "empty"
          : equip.skill.status === "ONLINE"
            ? "online"
            : "offline";
        const color = palette[status];
        const x = parsePercent(pos.left);
        const y = parsePercent(pos.top);
        // L-shape elbow gives the 2077-style PCB trace look. Half-vertical first,
        // then horizontal into the central node. Slots already level with the
        // central node skip the elbow and run a straight horizontal trace.
        const onAxis = Math.abs(y - cy) < 0.5;
        const midY = (y + cy) / 2;
        const path = onAxis
          ? `M ${x} ${y} L ${cx} ${cy}`
          : `M ${x} ${y} L ${x} ${midY} L ${cx} ${midY} L ${cx} ${cy}`;
        return (
          <g key={pos.i}>
            {/* Dark halo for contrast against bright spine art */}
            <path
              d={path}
              fill="none"
              stroke="rgba(0,0,0,0.55)"
              strokeWidth={status === "online" ? 3 : 2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={status === "online" ? 1.6 : 1}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={status === "online" ? 0.95 : 0.6}
              filter={status === "online" ? `url(#gd-conn-glow-${mode})` : undefined}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </svg>
  );
}
