import { invokeSkill } from "@/lib/skills/invoke";
import type {
  ExecutorCtx,
  NodeExecResult,
  SkillNode,
} from "../types";

export async function executeSkillNode(
  node: SkillNode,
  ctx: ExecutorCtx,
): Promise<NodeExecResult> {
  const equip = ctx.equipBySlot.get(node.slotIndex);
  if (!equip) {
    const rawMsg = `slot ${node.slotIndex} has no equipped skill`;
    const now = new Date();
    ctx.runLog.push({
      stepId: ctx.stepIdPrefix + node.id,
      startedAt: now.toISOString(),
      endedAt: now.toISOString(),
      durationMs: 0,
      ok: false,
      errorCode: "SLOT_EMPTY",
      errorMessage: rawMsg,
    });
    return {
      ok: false,
      errorCode: "SLOT_EMPTY",
      errorMessage: `node "${node.id}": ${rawMsg}`,
    };
  }
  if (equip.skill.status === "OFFLINE") {
    const rawMsg = `skill "${equip.skill.nameEn}" is OFFLINE — flip status to ONLINE in Skill Library`;
    const now = new Date();
    ctx.runLog.push({
      stepId: ctx.stepIdPrefix + node.id,
      skillId: equip.skill.id,
      startedAt: now.toISOString(),
      endedAt: now.toISOString(),
      durationMs: 0,
      ok: false,
      errorCode: "SKILL_OFFLINE",
      errorMessage: rawMsg,
    });
    return {
      ok: false,
      errorCode: "SKILL_OFFLINE",
      errorMessage: `node "${node.id}": ${rawMsg}`,
    };
  }

  const stepInput = ctx.resolveRef(node.inputFrom);
  const startedAt = new Date();
  const startMs = Date.now();
  const invokeResult = await invokeSkill(equip.skill, stepInput);
  const endedAt = new Date();

  if (!invokeResult.ok) {
    ctx.runLog.push({
      stepId: ctx.stepIdPrefix + node.id,
      skillId: equip.skill.id,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startMs,
      ok: false,
      errorCode: invokeResult.errorCode,
      errorMessage: invokeResult.errors.join("; "),
      output: invokeResult.output,
    });
    await ctx.emitProgress();
    return {
      ok: false,
      errorCode: invokeResult.errorCode,
      errorMessage: `node "${node.id}" failed (${invokeResult.errorCode}): ${invokeResult.errors.join("; ")}`,
    };
  }

  ctx.runLog.push({
    stepId: ctx.stepIdPrefix + node.id,
    skillId: equip.skill.id,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startMs,
    ok: true,
    output: invokeResult.output,
  });
  await ctx.emitProgress();
  return { ok: true, output: invokeResult.output };
}
