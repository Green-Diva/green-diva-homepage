import "server-only";
import type { AgentInvokeResult, AgentInvokeSource } from "@/lib/agentTypes";

// Placeholder. The runtime invocation layer for machines/agents is not yet
// wired — the loadout UI saves equip + pipelineConfig + dispatcherConfig, but
// nothing reads them at execution time. When implemented this should:
//
//   1. Load Agent + AgentSkillEquip + Skill rows
//   2. For MECHANICAL: traverse pipelineConfig (workflow nodes/edges) and
//      run each slotted skill in order, passing values along edges
//   3. For AUTONOMOUS: hand control to an LLM described by dispatcherConfig
//      and let it call slotted skills as tools
//   4. Track latency/cost/failures, write to a future AgentInvocation table,
//      and feed those numbers into the derived stats (chaos/cost/activity/stability)
//
// Until then this throws so we never silently no-op.
export async function invokeAgent(
  agentId: string,
  input: unknown,
  source: AgentInvokeSource,
): Promise<AgentInvokeResult> {
  void agentId;
  void input;
  void source;
  throw new Error("invokeAgent: NOT_IMPLEMENTED");
}
