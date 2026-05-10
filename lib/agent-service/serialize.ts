// Serialize SceneDefinition objects (which contain non-JSON-safe zod
// schemas) into a wire-shaped form the /agent-control page can render.
//
// We don't ship the zod schema itself — that'd require a full JSON Schema
// converter. Instead we extract a flat "field hint" describing the top-
// level keys (name + coarse type + optional flag), which is enough for
// the binding editor to label form fields and hint the admin about what
// `{{ctx.X}}` references are valid.
//
// Anything beyond ZodObject / ZodArray / primitives degrades to "unknown" —
// admin reads the source for richer detail.

import "server-only";
import type { z } from "zod";
import { listScenes } from "./registry";
import type { AnySceneDefinition } from "./types";

export type SchemaFieldHint = {
  name: string;
  type: string;
  optional: boolean;
};

export type SerializableSceneDef = {
  key: string;
  module: string;
  label: { en: string; zh: string };
  description?: { en: string; zh: string };
  invocation: "sync" | "async";
  requiredCapabilities: string[];
  // Top-level shape of contextSchema. Empty when the schema isn't a
  // ZodObject (e.g. z.unknown for outputs that callers extract from
  // runLog).
  contextFields: SchemaFieldHint[];
  outputFields: SchemaFieldHint[];
};

type ZodLike = { _def?: { typeName?: string; innerType?: ZodLike; type?: ZodLike } };

function unwrap(s: z.ZodTypeAny): z.ZodTypeAny {
  let cur = s as z.ZodTypeAny & ZodLike;
  // Optional / Nullable / Default wrap the real type — peel them.
  while (true) {
    const tn = cur._def?.typeName;
    if (
      (tn === "ZodOptional" || tn === "ZodNullable" || tn === "ZodDefault") &&
      cur._def?.innerType
    ) {
      cur = cur._def.innerType as z.ZodTypeAny & ZodLike;
      continue;
    }
    return cur;
  }
}

function zodTypeName(s: z.ZodTypeAny): string {
  const u = unwrap(s) as z.ZodTypeAny & ZodLike;
  const tn = u._def?.typeName;
  switch (tn) {
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodObject":
      return "object";
    case "ZodArray": {
      const inner = u._def?.type;
      return inner ? `array<${zodTypeName(inner as z.ZodTypeAny)}>` : "array";
    }
    case "ZodEnum":
      return "enum";
    case "ZodUnion":
      return "union";
    case "ZodLiteral":
      return "literal";
    case "ZodAny":
    case "ZodUnknown":
      return "unknown";
    default:
      return tn ? tn.replace(/^Zod/, "").toLowerCase() : "unknown";
  }
}

function isOptional(s: z.ZodTypeAny): boolean {
  const tn = (s as ZodLike)._def?.typeName;
  return tn === "ZodOptional" || tn === "ZodDefault" || tn === "ZodNullable";
}

function describeZod(schema: z.ZodTypeAny): SchemaFieldHint[] {
  const u = unwrap(schema) as z.ZodTypeAny & ZodLike;
  if (u._def?.typeName === "ZodObject") {
    const obj = u as unknown as z.ZodObject<z.ZodRawShape>;
    return Object.entries(obj.shape).map(([name, child]) => ({
      name,
      type: zodTypeName(child as z.ZodTypeAny),
      optional: isOptional(child as z.ZodTypeAny),
    }));
  }
  return [];
}

export function serializeScene(scene: AnySceneDefinition): SerializableSceneDef {
  return {
    key: scene.key,
    module: scene.module,
    label: scene.label,
    description: scene.description,
    invocation: scene.invocation,
    requiredCapabilities: scene.requiredCapabilities,
    contextFields: describeZod(scene.contextSchema),
    outputFields: describeZod(scene.outputSchema),
  };
}

export function listSerializableScenes(): SerializableSceneDef[] {
  return listScenes().map(serializeScene);
}
