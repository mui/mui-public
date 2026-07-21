import type { LoadFallbackCodeFn, LoadVariantFn, ComputeHastDeltasFn } from './CodeContext';
import type { CodeEditorModule } from '../useCode/codeEditorCache';
import type { CreateTransformedFiles } from '../useCode/TransformEngine';

/**
 * Preload keys + dynamic-import factories for CodeHighlighter's heavy functions.
 *
 * Shared by `CodeProvider` (which exposes them as lazy context accessors) and
 * `CodeHighlighterClient` (which speculatively preloads them on first render).
 * Using the identical `key -> factory` pair on both sides lets `PreloadProvider`
 * dedupe to a single fetch per page - the speculative preload and the eventual
 * consumer resolve the same promise.
 *
 * The `import()`s are inside the factories, so importing this module is cheap:
 * the heavy modules (and their transitive deps like jsondiffpatch) only load
 * when a factory is actually invoked.
 */

export const PRELOAD_KEY_LOAD_VARIANT = 'docs-infra/loadIsomorphicCodeVariant';
export const PRELOAD_KEY_LOAD_FALLBACK = 'docs-infra/loadCodeFallback';
export const PRELOAD_KEY_COMPUTE_DELTAS = 'docs-infra/computeHastDeltas';

export const loadVariantFactory = async (): Promise<LoadVariantFn> =>
  (await import('../pipeline/loadIsomorphicCodeVariant/loadIsomorphicCodeVariant'))
    .loadIsomorphicCodeVariant;

export const loadFallbackFactory = async (): Promise<LoadFallbackCodeFn> =>
  (await import('../pipeline/loadIsomorphicCodeVariant/loadCodeFallback')).loadCodeFallback;

export const computeHastDeltasFactory = async (): Promise<ComputeHastDeltasFn> =>
  (await import('../pipeline/loadIsomorphicCodeVariant/computeHastDeltas')).computeHastDeltas;

export const PRELOAD_KEY_CODE_EDITOR = 'docs-infra/codeEditor';

export const codeEditorFactory = async (): Promise<CodeEditorModule> =>
  import('../useCode/CodeEditor');

export const PRELOAD_KEY_TRANSFORM_ENGINE = 'docs-infra/transformEngine';

export const transformEngineFactory = async (): Promise<CreateTransformedFiles> =>
  (await import('../useCode/TransformEngine')).createTransformedFiles;
