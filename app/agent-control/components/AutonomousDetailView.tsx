"use client";

import DetailHeader from "./DetailHeader";
import DeployButton from "./DeployButton";
import BaseStatsBar from "./BaseStatsBar";
import AgentHeroPortrait from "./AgentHeroPortrait";
import SkillsControlPanel from "./SkillsControlPanel";
import type { AgentRow, EquipRow, SkillRow, SceneBindingRow } from "../types";
import type { SerializableSceneDef } from "@/lib/agent-service/serialize";

export default function AutonomousDetailView({
  agent,
  equips,
  allSkills,
  isAdmin,
  sceneDefs,
  sceneBindings,
  autoDeployNonce,
  onEdit,
  onShowJobs,
}: {
  agent: AgentRow;
  equips: EquipRow[];
  allSkills: SkillRow[];
  isAdmin: boolean;
  sceneDefs: SerializableSceneDef[];
  sceneBindings: SceneBindingRow[];
  autoDeployNonce: number | null;
  onEdit: () => void;
  onShowJobs?: () => void;
}) {
  const isOffline = agent.status === "OFFLINE";
  const dimmed = isOffline ? "opacity-50 grayscale pointer-events-none select-none" : "";
  return (
    <div className="flex flex-col h-full gap-3 min-h-0">
      <div className="flex items-start justify-between gap-3 shrink-0">
        <DetailHeader
          agent={agent}
          equips={equips}
          isAdmin={isAdmin}
          onEdit={onEdit}
          onShowJobs={onShowJobs}
          dimNonEdit={isOffline}
        />
        <DeployButton
          agent={agent}
          isAdmin={isAdmin}
          sceneDefs={sceneDefs}
          sceneBindings={sceneBindings}
          autoOpenNonce={autoDeployNonce}
        />
      </div>
      <div className={`flex flex-col gap-3 flex-1 min-h-0 ${dimmed}`}>
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
    </div>
  );
}
