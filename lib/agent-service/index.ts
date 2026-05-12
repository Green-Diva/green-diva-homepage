// Public surface of the agent-service. Modules import from here:
//
//   import { registerScene, dispatchScene, callScene } from "@/lib/agent-service";
//
// Anything not re-exported below is package-internal. In particular, the
// runtime registry singleton itself (registry.ts) is hidden behind the
// register/get/list functions on purpose — never grab the Map directly.

export {
  registerScene,
  registerSceneAlias,
  getScene,
  requireScene,
  listScenes,
  listScenesByModule,
} from "./registry";

export { callScene, dispatchScene } from "./dispatch";

export {
  serializeScene,
  listSerializableScenes,
  type SerializableSceneDef,
  type SchemaFieldHint,
} from "./serialize";

export {
  SceneError,
  type SceneActor,
  type SceneDefinition,
  type SceneContextOf,
  type SceneOutputOf,
  type SceneCallResult,
  type SceneCallSuccess,
  type SceneCallFailure,
  type SceneDispatchResult,
  type SceneErrorCode,
  type AnySceneDefinition,
} from "./types";

// Re-export the AgentRunLogEntry type so sync-call sites can typecheck
// their result.runLog inspection without importing from lib/agents/.
// They still need to cast (SceneCallResult.runLog is unknown), but at
// least the cast target lives in this package.
export type { AgentRunLogEntry } from "@/lib/agents/invoke";
