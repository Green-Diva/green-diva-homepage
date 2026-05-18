import type { AgentRow, EquipRow } from "@/app/agent-control/types";

export type EquippedByEntry = {
  agent: AgentRow;
  slotIndex: number | null;
};

// Aggregate which agents currently equip a given skill. Stable codename
// sort. Returns [] when any required input is missing — callers can render
// "not equipped" without further branching.
export function collectEquippedBy(
  skillId: string | null | undefined,
  equipsByAgentId: Record<string, EquipRow[]> | null | undefined,
  agents: AgentRow[] | null | undefined,
): EquippedByEntry[] {
  if (!skillId || !equipsByAgentId || !agents) return [];
  const list: EquippedByEntry[] = [];
  for (const [agentId, equips] of Object.entries(equipsByAgentId)) {
    const hit = equips.find((e) => e.skillId === skillId);
    if (!hit) continue;
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) continue;
    list.push({ agent, slotIndex: hit.slotIndex });
  }
  return list.sort((a, b) => a.agent.codename.localeCompare(b.agent.codename));
}
