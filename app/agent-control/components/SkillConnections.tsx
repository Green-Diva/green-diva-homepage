"use client";

import type { AgentMode, EquipRow } from "../types";
import type { CentralPos, SlotPos } from "@/lib/agentControl/slotPositions";
import { MECH_HEX, AGENT_HEX } from "@/lib/agentControl/theme";

// Connection state: skill equipped + ONLINE → mode accent color;
// equipped + OFFLINE → gray; empty slot → gray.
type ConnectionStatus = "online" | "offline" | "empty";

const STATUS_COLORS: Record<AgentMode, Record<ConnectionStatus, string>> = {
  MECHANICAL: {
    online: MECH_HEX,
    offline: "rgba(180,180,180,0.45)",
    empty: "rgba(180,180,180,0.18)",
  },
  AUTONOMOUS: {
    online: AGENT_HEX,
    offline: "rgba(180,180,180,0.45)",
    empty: "rgba(180,180,180,0.18)",
  },
};

function parsePercent(v: string): number {
  return Number(v.replace("%", ""));
}

function statusOf(equip: EquipRow | undefined | null): ConnectionStatus {
  if (!equip) return "empty";
  return equip.skill.status === "ONLINE" ? "online" : "offline";
}

function statusRank(s: ConnectionStatus): number {
  return s === "online" ? 2 : s === "offline" ? 1 : 0;
}

// A trunk only carries signal when both endpoints can — pick the weaker so a
// trunk into an empty slot stays dim even if the on-axis end is ONLINE.
function combineStatus(a: ConnectionStatus, b: ConnectionStatus): ConnectionStatus {
  return statusRank(a) <= statusRank(b) ? a : b;
}

type Trace = {
  key: string;
  path: string;
  status: ConnectionStatus;
};

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

  const traces: Trace[] = [];

  // Column trunks: from each on-axis slot, draw vertical segments to its
  // column neighbours so all 6 slots read as one connected harness.
  for (const mid of slots.filter((p) => Math.abs(parsePercent(p.top) - cy) < 0.5)) {
    const midStatus = statusOf(slotted.get(mid.i));
    const mx = parsePercent(mid.left);
    const my = parsePercent(mid.top);
    const sameCol = slots.filter(
      (p) => Math.abs(parsePercent(p.left) - mx) < 0.5 && p.i !== mid.i,
    );
    for (const peer of sameCol) {
      const peerStatus = statusOf(slotted.get(peer.i));
      const py = parsePercent(peer.top);
      traces.push({
        key: `trunk-${mid.i}-${peer.i}`,
        path: `M ${mx} ${my} L ${mx} ${py}`,
        status: combineStatus(midStatus, peerStatus),
      });
    }
  }

  // L-shape elbow from each off-axis slot to the central node; on-axis slots
  // run a straight horizontal trace.
  for (const pos of slots) {
    const status = statusOf(slotted.get(pos.i));
    const x = parsePercent(pos.left);
    const y = parsePercent(pos.top);
    const onAxis = Math.abs(y - cy) < 0.5;
    const midY = (y + cy) / 2;
    const path = onAxis
      ? `M ${x} ${y} L ${cx} ${cy}`
      : `M ${x} ${y} L ${x} ${midY} L ${cx} ${midY} L ${cx} ${cy}`;
    traces.push({ key: `elbow-${pos.i}`, path, status });
  }

  // Off-axis elbows from opposite columns share the central segment
  // (cx, midY → cx, cy). Draw weaker traces first so an empty slot's gray
  // doesn't paint over an adjacent ONLINE slot's glow.
  traces.sort((a, b) => statusRank(a.status) - statusRank(b.status));

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
      {/* Halo pass — dark backing for every trace, kept under all colour. */}
      {traces.map((t) => {
        const isOnline = t.status === "online";
        return (
          <path
            key={`halo-${t.key}`}
            d={t.path}
            fill="none"
            stroke="rgba(0,0,0,0.55)"
            strokeWidth={isOnline ? 3 : 2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {/* Colour pass — sorted weak→strong so ONLINE glow paints last. */}
      {traces.map((t) => {
        const color = palette[t.status];
        const isOnline = t.status === "online";
        return (
          <path
            key={`color-${t.key}`}
            d={t.path}
            fill="none"
            stroke={color}
            strokeWidth={isOnline ? 1.6 : 1}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={isOnline ? 0.95 : 0.6}
            filter={isOnline ? `url(#gd-conn-glow-${mode})` : undefined}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}
