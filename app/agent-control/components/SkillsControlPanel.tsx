"use client";

import EquipmentLoadout from "./EquipmentLoadout";
import SkillsLoadoutColumn from "./SkillsLoadoutColumn";
import type { AgentRow, EquipRow, SkillRow } from "../types";
import { themeClass } from "@/lib/agentControl/theme";

export default function SkillsControlPanel({
  agent,
  equips,
  allSkills,
  isAdmin,
}: {
  agent: AgentRow;
  equips: EquipRow[];
  allSkills: SkillRow[];
  isAdmin: boolean;
}) {
  const isMech = agent.mode === "MECHANICAL";
  const accentText = themeClass(agent.mode, "text");
  const accentBorder = themeClass(agent.mode, "borderSoft");
  const accentMarker = themeClass(agent.mode, "marker");

  return (
    <div
      className={[
        "relative h-full w-full rounded-md border bg-background/50 p-3",
        accentBorder,
      ].join(" ")}
    >
      <div
        className={[
          "absolute -top-2 left-3 px-2 leading-none font-label text-[10px] tracking-[0.3em] uppercase bg-background",
          accentText,
        ].join(" ")}
      >
        {isMech ? "Skills & Backbone Configure" : "Skills & Orchestrator Configure"}
      </div>
      <span
        aria-hidden
        className={[
          "absolute top-0 right-0 w-3 h-3 pointer-events-none",
          "before:content-[''] before:absolute before:top-0 before:right-0 before:h-px before:w-full",
          "after:content-[''] after:absolute after:top-0 after:right-0 after:w-px after:h-full",
          accentMarker,
        ].join(" ")}
      />
      <span
        aria-hidden
        className={[
          "absolute bottom-0 left-0 w-3 h-3 pointer-events-none",
          "before:content-[''] before:absolute before:bottom-0 before:left-0 before:h-px before:w-full",
          "after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-px after:h-full",
          accentMarker,
        ].join(" ")}
      />

      <div className="h-full flex flex-row gap-3 items-stretch min-h-0">
        <EquipmentLoadout
          agent={agent}
          equips={equips}
          allSkills={allSkills}
          isAdmin={isAdmin}
        />
        <SkillsLoadoutColumn
          agent={agent}
          equips={equips}
          allSkills={allSkills}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  );
}
