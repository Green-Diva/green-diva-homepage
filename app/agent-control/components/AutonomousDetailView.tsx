"use client";

import DetailHeader from "./DetailHeader";
import DeployButton from "./DeployButton";
import BaseStatsBar from "./BaseStatsBar";
import AgentHeroPortrait from "./AgentHeroPortrait";
import SkillsControlPanel from "./SkillsControlPanel";
import type { AgentRow, EquipRow, SkillRow } from "../types";

export default function AutonomousDetailView({
  agent,
  equips,
  allSkills,
  isAdmin,
  onEdit,
  onShowJobs,
}: {
  agent: AgentRow;
  equips: EquipRow[];
  allSkills: SkillRow[];
  isAdmin: boolean;
  onEdit: () => void;
  onShowJobs?: () => void;
}) {
  return (
    <div className="flex flex-col h-full gap-3 min-h-0">
      <div className="flex items-start justify-between gap-3 shrink-0">
        <DetailHeader agent={agent} equips={equips} isAdmin={isAdmin} onEdit={onEdit} onShowJobs={onShowJobs} />
        <DeployButton agent={agent} isAdmin={isAdmin} />
      </div>
      <BaseStatsBar agent={agent} />
      <div className="flex-1 min-h-0 grid grid-cols-[calc((100%+48px)/4)_minmax(0,1fr)] gap-x-4 items-stretch">
        <AgentHeroPortrait agent={agent} />
        <div className="min-h-0">
          <SkillsControlPanel
            key={`scp-${agent.id}`}
            agent={agent}
            equips={equips}
            allSkills={allSkills}
            isAdmin={isAdmin}
          />
        </div>
      </div>
    </div>
  );
}
