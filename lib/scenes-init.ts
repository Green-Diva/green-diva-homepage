// Central scene-registration entrypoint.
//
// Each site module owns a `lib/<module>/scenes.ts` file that calls
// `registerScene(...)` at module-init time (a side-effect import). This
// file's only job is to make sure those side-effect imports actually
// execute — without a central import chain, a module's scenes file might
// never be loaded, and dispatchScene would 404 with UNKNOWN_SCENE.
//
// Add a new module: import its scenes file below. Nothing else changes.
//
// This file is imported by lib/server-init.ts (top-level import, not
// inside ensureServerInit()) so the registry is populated as soon as any
// API route module loads — well before the first dispatchScene call.

import "server-only";

// Module scenes — each import triggers registerScene side-effects:
import "@/lib/relics/scenes";
// Future modules append here, e.g.:
//   import "@/lib/vault/scenes";
//   import "@/lib/profile/scenes";

// Intentionally empty re-export so dead-code elimination can't strip the
// file. The side-effect imports above are the actual payload; this object
// just gives the bundler something to hold onto.
export const SCENES_REGISTERED = true as const;
