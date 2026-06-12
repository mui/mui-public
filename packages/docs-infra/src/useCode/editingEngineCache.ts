import type * as EditingEngine from './EditingEngine';

/** The resolved editing-engine module: `createEditableEngine` + source-editing fns. */
export type EditingEngineModule = typeof EditingEngine;

/**
 * Resolves the live-editing engine module. `CodeProvider` supplies one via
 * context (eager → bundled, resolves instantly; lazy → dynamic `import()`);
 * `useEditable` / `useSourceEditing` also have the built-in default below so
 * editing works without a provider.
 */
export type EditingEngineLoader = () => Promise<EditingEngineModule>;

// Set DEBUG=true to log editing-engine load failures (e.g. a chunk-load error
// after a rotated deploy). Off by default — a failed load fails open (the block
// stays read-only / the edit no-ops) per convention 9.3.
const DEBUG = false;

// Module-level cache of the resolved editing-engine module, shared by
// `useEditable` (reads `createEditableEngine`) and `useSourceEditing` (reads the
// source-editing fns). Because both gate on the same "is-editable" signal and
// load the SAME chunk, the first editable block resolves it once and every
// reader after that — including the first keystroke's source-editing call — sees
// it warm and runs synchronously.
let cached: EditingEngineModule | undefined;

/** Built-in loader, used when no provider supplies an `editingEngineLoader`. */
export const defaultEditingEngineLoader: EditingEngineLoader = () => import('./EditingEngine');

/** Synchronously reads the cached module, or `undefined` if not yet resolved. */
export function peekEditingEngine(): EditingEngineModule | undefined {
  return cached;
}

/**
 * Resolves the editing-engine module (from the warm cache, else via the loader)
 * and caches it. Returns the cached value synchronously when warm. Rejects if
 * the load fails; callers decide whether to surface or swallow that.
 */
export function loadEditingEngine(
  loader?: EditingEngineLoader,
): EditingEngineModule | Promise<EditingEngineModule> {
  if (cached) {
    return cached;
  }
  return (loader ?? defaultEditingEngineLoader)().then((mod) => {
    cached = mod;
    return mod;
  });
}

/**
 * Eagerly resolves and caches the editing-engine module so the next editable
 * block attaches (and the first edit commits) synchronously instead of after a
 * load round-trip. Fire-and-forget — fails open. Pass the provider's
 * `editingEngineLoader` to share its page-wide deduplication.
 */
export async function preloadEditingEngine(loader?: EditingEngineLoader): Promise<void> {
  if (cached) {
    return;
  }
  try {
    await loadEditingEngine(loader);
  } catch (error) {
    if (DEBUG) {
      console.error('[docs-infra] editing engine failed to preload', error);
    }
  }
}

/** Clears the cache so the next resolve loads from scratch. For tests. */
export function resetEditingEngineCache(): void {
  cached = undefined;
}
