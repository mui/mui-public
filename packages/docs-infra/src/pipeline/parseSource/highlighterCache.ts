/**
 * Light, client-reachable facade over the highlighting engine in `./parseSource`.
 *
 * Importing this module must NOT pull the engine (`@pierre/highlights` and its
 * WebAssembly payload) into the bundle — the engine is reached only through the
 * dynamic `import()` in {@link loadHighlighter}. That keeps `CodeHighlighter`
 * free of the engine until a block actually needs to highlight, mirroring the
 * `./useCode/transformEngineCache` split.
 */

// Must match HIGHLIGHTER_KEY in ./parseSource. Duplicated intentionally to keep
// this module free of a static `./parseSource` import (which would pull the
// engine into every consumer's bundle).
const HIGHLIGHTER_KEY = '__docs_infra_highlighter_instance__';

/**
 * Synchronously reports whether the engine is loaded. Reads the shared singleton
 * without importing the engine, so it is safe on the render path (e.g. a
 * `useState` initializer) to decide whether a block can highlight immediately or
 * must wait — avoiding a cold flash.
 */
export function isHighlighterLoaded(): boolean {
  return (globalThis as Record<string, unknown>)[HIGHLIGHTER_KEY] !== undefined;
}

/**
 * Loads the highlighting engine, which includes every supported language. A
 * no-op once loaded (warm — e.g. a prior block, the speculative preload, or an
 * eager `CodeProvider` loaded it), so it is cheap to call on render or as a
 * speculative preload. Concurrent calls share one load.
 */
export async function loadHighlighter(): Promise<void> {
  if (isHighlighterLoaded()) {
    return;
  }
  const { createParseSource } = await import('./parseSource');
  await createParseSource();
}
