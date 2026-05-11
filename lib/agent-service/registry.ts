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
// Alias map for scene-key renames. `getScene(alias)` resolves to the canonical
// scene. Aliases are NOT listed in listScenes() (admin UI sees only canonical
// keys); they exist purely to keep old SceneBinding rows / endpoint callers
// working while a rename rolls out. Drop the alias entry after the
// corresponding DB rows have been migrated.
const sceneAliases = new Map<string, string>();

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
  const direct = scenes.get(key);
  if (direct) return direct;
  const canonical = sceneAliases.get(key);
  if (canonical) return scenes.get(canonical) ?? null;
  return null;
}

/**
 * Register an alias that resolves to a canonical scene key. Used during scene
 * renames to keep existing SceneBinding rows / call sites working while the
 * canonical name is being adopted. Aliases do NOT appear in listScenes().
 */
export function registerSceneAlias(aliasKey: string, canonicalKey: string): void {
  if (!KEY_RE.test(aliasKey)) {
    throw new SceneError(
      "UNKNOWN_SCENE",
      `invalid alias key "${aliasKey}" — must match <module>.<verb>`,
      500,
    );
  }
  if (scenes.has(aliasKey)) {
    throw new SceneError(
      "UNKNOWN_SCENE",
      `alias "${aliasKey}" collides with a registered scene; rename the scene first`,
      500,
    );
  }
  sceneAliases.set(aliasKey, canonicalKey);
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
