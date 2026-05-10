// Scene Registry — process-singleton holding every scene any module has
// registered. Populated at module-init time via lib/scenes-init.ts; read
// by dispatch / callScene + the /agent-control?tab=scenes UI.
//
// Module isolation: each module owns a file (e.g. lib/relics/scenes.ts)
// that imports registerScene and declares its own scenes. The central
// init module just imports all of them — adding a new module = creating
// one file + one import line.

import "server-only";
import { SceneError, type AnySceneDefinition, type SceneDefinition } from "./types";
import type { z } from "zod";

// "<lowercase letter>" + "<lowercase / digits / dash>"... + "." + same — at least one dot.
// Forces the "<module>.<verb>" convention so the binding UI's per-module
// grouping isn't a guess. Hyphens allowed in the verb half ("relic.regen-metadata").
const KEY_RE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/;
const MODULE_RE = /^[a-z][a-z0-9-]*$/;

const scenes = new Map<string, AnySceneDefinition>();

/**
 * Register a scene. Call from module-side `lib/<module>/scenes.ts` files.
 *
 * Throws on:
 *   - duplicate key (re-registration with a different definition)
 *   - malformed key / module
 *   - missing zod schemas
 *
 * Re-registration with the SAME object reference is a no-op (HMR-safe).
 */
export function registerScene<
  TContext extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(scene: SceneDefinition<TContext, TOutput>): SceneDefinition<TContext, TOutput> {
  if (!KEY_RE.test(scene.key)) {
    throw new SceneError(
      "UNKNOWN_SCENE",
      `invalid scene key "${scene.key}" — must match <module>.<verb> e.g. "relic.enhance2d"`,
      500,
    );
  }
  if (!MODULE_RE.test(scene.module)) {
    throw new SceneError(
      "UNKNOWN_SCENE",
      `invalid scene module "${scene.module}" — must be lowercase ascii / digits / dash`,
      500,
    );
  }
  // Module prefix must match key prefix — catches typos like
  // {key:"relic.foo", module:"vault"}.
  const keyPrefix = scene.key.slice(0, scene.key.indexOf("."));
  if (keyPrefix !== scene.module) {
    throw new SceneError(
      "UNKNOWN_SCENE",
      `scene "${scene.key}" declares module "${scene.module}" but key prefix is "${keyPrefix}"`,
      500,
    );
  }

  const existing = scenes.get(scene.key);
  if (existing && existing !== scene) {
    // Same key, different object references — overwrite. In dev this is
    // routinely Turbopack/HMR re-evaluating the same scenes.ts file (each
    // eval produces fresh object literals). In production it'd mean two
    // distinct files registered the same key, which is a real bug; we warn
    // loudly but don't crash, since crashing here takes down the whole
    // /agent-control page and there's no admin recovery path.
    const tag = process.env.NODE_ENV === "production" ? "[ERROR]" : "[hmr]";
    console.warn(
      `[scene-registry] ${tag} "${scene.key}" re-registered with a different definition; overwriting.`,
    );
  }
  scenes.set(scene.key, scene as unknown as AnySceneDefinition);
  return scene;
}

export function getScene(key: string): AnySceneDefinition | null {
  return scenes.get(key) ?? null;
}

export function requireScene(key: string): AnySceneDefinition {
  const scene = scenes.get(key);
  if (!scene) {
    throw new SceneError("UNKNOWN_SCENE", `scene "${key}" is not registered`, 404);
  }
  return scene;
}

export function listScenes(): AnySceneDefinition[] {
  return Array.from(scenes.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export function listScenesByModule(): Record<string, AnySceneDefinition[]> {
  const grouped: Record<string, AnySceneDefinition[]> = {};
  for (const s of listScenes()) {
    (grouped[s.module] ??= []).push(s);
  }
  return grouped;
}

// Test-only — wipe the registry between unit tests. Not exported via the
// public package barrel; do not call from production code.
export function __resetSceneRegistry(): void {
  scenes.clear();
}
