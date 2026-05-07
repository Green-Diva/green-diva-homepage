// Backbone (MECHANICAL) executor — Phase 3 MVP: linear pipeline.
//
// pipelineConfig shape:
//   {
//     "version": 1,
//     "steps": [
//       { "id": "s1", "equipSlot": 0, "inputMapping": { "from": "agent.input" } },
//       { "id": "s2", "equipSlot": 2, "inputMapping": { "from": "s1.output" } }
//     ]
//   }
//
// Each step:
//   - Resolves equipSlot → AgentSkillEquip → Skill
//   - Validates: slot has an equip + skill is ONLINE
//   - Resolves input via inputMapping.from ("agent.input" | "<stepId>.output")
//   - Calls invokeSkill (Phase 1 handler dispatch + JSON Schema validation)
//   - Appends a runLog entry (success or failure)
//   - Stops execution on failure; returns AgentRunFailure carrying the runLog
//     up to and including the failed step.
//
// Final output = last step's output. Branching/parallel/conditional execution
// land in Phase 5 with the DAG editor.

import "server-only";
import { prisma } from "@/lib/db";
import { invokeSkill } from "@/lib/skills/invoke";
import type { AgentRunResult, AgentRunLogEntry } from "@/lib/agents/invoke";

type PipelineStep = {
  id: string;
  equipSlot: number;
  inputMapping: { from: string };
};

type PipelineConfig = {
  version: number;
  steps: PipelineStep[];
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseInputRef(
  from: unknown,
): { kind: "agent_input" } | { kind: "step"; stepId: string } | null {
  if (from !== "agent.input" && typeof from !== "string") return null;
  if (from === "agent.input") return { kind: "agent_input" };
  const m = (from as string).match(/^([a-zA-Z0-9_-]+)\.output$/);
  return m ? { kind: "step", stepId: m[1] } : null;
}

// Coerce + validate the loose Json column into a typed PipelineConfig.
// Returns either the typed config or an error code/message describing why
// the config can't run. Doesn't throw — caller assembles AgentRunFailure.
function validatePipelineConfig(
  cfg: unknown,
): { ok: true; config: PipelineConfig } | { ok: false; code: string; message: string } {
  if (!isObject(cfg)) {
    return { ok: false, code: "PIPELINE_MISSING", message: "pipelineConfig is empty — set up the Backbone before invoking" };
  }
  if (cfg.version !== 1) {
    return { ok: false, code: "PIPELINE_VERSION", message: `pipelineConfig.version must be 1 (got ${String(cfg.version)})` };
  }
  if (!Array.isArray(cfg.steps)) {
    return { ok: false, code: "PIPELINE_INVALID", message: "pipelineConfig.steps must be an array" };
  }
  if (cfg.steps.length === 0) {
    return { ok: false, code: "PIPELINE_EMPTY", message: "pipelineConfig.steps is empty — add at least one step" };
  }

  const seenIds = new Set<string>();
  for (const [i, raw] of cfg.steps.entries()) {
    if (!isObject(raw)) {
      return { ok: false, code: "PIPELINE_INVALID", message: `step[${i}] is not an object` };
    }
    const id = raw.id;
    if (typeof id !== "string" || !id) {
      return { ok: false, code: "PIPELINE_INVALID", message: `step[${i}].id must be a non-empty string` };
    }
    if (seenIds.has(id)) {
      return { ok: false, code: "PIPELINE_INVALID", message: `duplicate step id "${id}"` };
    }
    seenIds.add(id);
    const slot = raw.equipSlot;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot > 5) {
      return { ok: false, code: "PIPELINE_INVALID", message: `step "${id}".equipSlot must be integer 0-5 (got ${String(slot)})` };
    }
    const mapping = raw.inputMapping;
    if (!isObject(mapping) || parseInputRef(mapping.from) === null) {
      return {
        ok: false,
        code: "PIPELINE_INVALID",
        message: `step "${id}".inputMapping.from must be "agent.input" or "<stepId>.output"`,
      };
    }
  }

  return { ok: true, config: cfg as unknown as PipelineConfig };
}

export async function runBackbone(opts: {
  agentId: string;
  input: unknown;
  pipelineConfig: unknown;
}): Promise<AgentRunResult> {
  const v = validatePipelineConfig(opts.pipelineConfig);
  if (!v.ok) {
    return { ok: false, errorCode: v.code, errorMessage: v.message, runLog: [] };
  }
  const config = v.config;

  // Cross-check that every referenced step id occurs *before* it's used.
  // (Forward references would cause UNKNOWN_REF at runtime; surface it
  // earlier as a config error so the user fixes the pipeline shape.)
  const stepIds = new Set<string>();
  for (const s of config.steps) {
    const ref = parseInputRef(s.inputMapping.from)!;
    if (ref.kind === "step" && !stepIds.has(ref.stepId)) {
      return {
        ok: false,
        errorCode: "PIPELINE_INVALID",
        errorMessage: `step "${s.id}" references "${ref.stepId}.output" which doesn't precede it`,
        runLog: [],
      };
    }
    stepIds.add(s.id);
  }

  // Load all equips for this agent in one query.
  const equips = await prisma.agentSkillEquip.findMany({
    where: { agentId: opts.agentId, slotIndex: { not: null } },
    include: { skill: true },
  });
  const equipBySlot = new Map<number, (typeof equips)[number]>();
  for (const e of equips) {
    if (e.slotIndex !== null) equipBySlot.set(e.slotIndex, e);
  }

  const runLog: AgentRunLogEntry[] = [];
  const stepOutputs = new Map<string, unknown>();

  for (const step of config.steps) {
    const startedAt = new Date();
    const stepStart = Date.now();

    function fail(code: string, message: string, skillId?: string): AgentRunResult {
      const endedAt = new Date();
      runLog.push({
        stepId: step.id,
        skillId,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - stepStart,
        ok: false,
        errorCode: code,
        errorMessage: message,
      });
      return { ok: false, errorCode: code, errorMessage: `step "${step.id}": ${message}`, runLog };
    }

    const equip = equipBySlot.get(step.equipSlot);
    if (!equip) {
      return fail("SLOT_EMPTY", `slot ${step.equipSlot} has no equipped skill`);
    }
    if (equip.skill.status === "OFFLINE") {
      return fail(
        "SKILL_OFFLINE",
        `skill "${equip.skill.nameEn}" is OFFLINE — flip status to ONLINE in Skill Library after configuring`,
        equip.skill.id,
      );
    }

    const ref = parseInputRef(step.inputMapping.from)!; // validated above
    let stepInput: unknown;
    if (ref.kind === "agent_input") {
      stepInput = opts.input;
    } else {
      // stepOutputs MUST contain this id (forward-ref check above).
      stepInput = stepOutputs.get(ref.stepId);
    }

    const invokeResult = await invokeSkill(equip.skill, stepInput);
    const endedAt = new Date();

    if (!invokeResult.ok) {
      runLog.push({
        stepId: step.id,
        skillId: equip.skill.id,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - stepStart,
        ok: false,
        errorCode: invokeResult.errorCode,
        errorMessage: invokeResult.errors.join("; "),
        // Surface partial output (e.g. for OUTPUT_SCHEMA_VIOLATION) so the
        // operator can see what actually came back from the handler.
        output: invokeResult.output,
      });
      return {
        ok: false,
        errorCode: invokeResult.errorCode,
        errorMessage: `step "${step.id}" failed (${invokeResult.errorCode}): ${invokeResult.errors.join("; ")}`,
        runLog,
      };
    }

    runLog.push({
      stepId: step.id,
      skillId: equip.skill.id,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - stepStart,
      ok: true,
      output: invokeResult.output,
    });
    stepOutputs.set(step.id, invokeResult.output);
  }

  const lastStep = config.steps[config.steps.length - 1];
  return {
    ok: true,
    output: stepOutputs.get(lastStep.id),
    runLog,
  };
}
