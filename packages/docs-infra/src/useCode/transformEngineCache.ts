import type { CreateTransformedFiles } from './TransformEngine';
import type { TransformEngineLoader } from '../CodeProvider/CodeContext';

// Set DEBUG=true to log transform-engine load failures (e.g. a chunk-load error
// after a rotated deploy, or offline). Off by default — a failed load fails open
// (transforms simply don't apply) per convention 9.3.
const DEBUG = false;

// Module-level cache of the resolved transform applier (`createTransformedFiles`,
// which pulls the `jsondiffpatch` chunk). Kept in this *light* module — which only
// reaches the heavy chunk through the dynamic `import()` below — so it can be
// primed by `CodeHighlighter`'s speculative preload (in the client chunk) AND read
// by `useTransformManagement` (in the content chunk) without either statically
// pulling the other in. The first transform-bearing block resolves it once; every
// block after reads it synchronously, so the swap-commit build stays synchronous.
let cached: CreateTransformedFiles | undefined;

/** Built-in loader, used when no provider supplies a `transformEngineLoader`. */
export const defaultTransformEngineLoader: TransformEngineLoader = () =>
  import('./TransformEngine').then((mod) => mod.createTransformedFiles);

/** Synchronously reads the cached applier, or `undefined` if not yet resolved. */
export function peekTransformEngine(): CreateTransformedFiles | undefined {
  return cached;
}

/**
 * Resolves the applier (from the warm cache, else via the loader) and caches it.
 * Returns the cached value synchronously when warm. Rejects if the load fails;
 * callers decide whether to surface or swallow that.
 */
export function loadTransformEngine(
  loader?: TransformEngineLoader,
): CreateTransformedFiles | Promise<CreateTransformedFiles> {
  if (cached) {
    return cached;
  }
  return (loader ?? defaultTransformEngineLoader)().then((create) => {
    cached = create;
    return create;
  });
}

/**
 * Eagerly resolves and caches the applier so the next transform swap (and the
 * first transform-bearing block's first render) build synchronously instead of
 * flashing un-transformed files. Fire-and-forget — fails open. Pass the provider's
 * `transformEngineLoader` to share its page-wide deduplication.
 */
export async function preloadTransformEngine(loader?: TransformEngineLoader): Promise<void> {
  if (cached) {
    return;
  }
  try {
    await loadTransformEngine(loader);
  } catch (error) {
    if (DEBUG) {
      console.error('[docs-infra] transform engine failed to preload', error);
    }
  }
}

/** Clears the cache so the next resolve loads from scratch. For tests. */
export function resetTransformEngineCache(): void {
  cached = undefined;
}
