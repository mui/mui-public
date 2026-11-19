/**
 * Light, client-reachable facade over the highlighting engine in `./parseSource`.
 *
 * Importing this module must NOT pull the engine (`@pierre/highlights` and its
 * WebAssembly payload) into the bundle — the engine is reached only through the
 * dynamic `import()` in {@link ensureGrammars}. That keeps `CodeHighlighter`
 * free of the engine until a block actually needs to highlight, mirroring the
 * `./useCode/transformEngineCache` split.
 */

// Must match HIGHLIGHTER_KEY in ./parseSource. Duplicated intentionally to keep
// this module free of a static `./parseSource` import (which would pull the
// engine into every consumer's bundle).
const HIGHLIGHTER_KEY = '__docs_infra_highlighter_instance__';

// The narrow slice of the highlighter instance this module reads synchronously.
type ScopeReader = { scopes: () => ReadonlyArray<string> };

function getInstance(): ScopeReader | undefined {
  return (globalThis as Record<string, unknown>)[HIGHLIGHTER_KEY] as ScopeReader | undefined;
}

/** Returns `undefined` before the shared highlighter has been loaded. */
export function isGrammarRegistered(scope: string): boolean | undefined {
  const instance = getInstance();
  return instance ? instance.scopes().includes(scope) : undefined;
}

/**
 * Synchronously reports whether every given scope can be highlighted now.
 * Reads the shared singleton without importing the engine, so it is safe on the
 * render path (e.g. a `useState` initializer) to decide whether a block can
 * highlight immediately or must wait — avoiding a cold flash.
 */
export function areGrammarsRegistered(scopes: string[]): boolean {
  if (scopes.length === 0) {
    return true;
  }
  if (!getInstance()) {
    return false;
  }
  return scopes.every((scope) => isGrammarRegistered(scope));
}

/**
 * Ensures the given scopes can be highlighted, loading the engine on demand. A
 * synchronous no-op once the engine is loaded (warm — e.g. a prior block, the
 * speculative preload, or an eager `CodeProvider` primed it), so it is cheap to
 * call on render or as a speculative preload. Fails open: a failed load leaves
 * code as plain text.
 */
export async function ensureGrammars(scopes: string[]): Promise<void> {
  if (scopes.length === 0 || areGrammarsRegistered(scopes)) {
    return;
  }
  const { registerGrammars } = await import('./parseSource');
  await registerGrammars(scopes);
}

/**
 * Loads the engine with every supported language. Backs the
 * `preloadGrammars: 'all'` provider opt-in. Fails open.
 */
export async function preloadAllGrammars(): Promise<void> {
  const { registerAllGrammars } = await import('./parseSource');
  await registerAllGrammars();
}
