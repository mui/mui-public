import type { CodeHighlighter } from './CodeHighlighter';
import { hasAllVariants } from '../pipeline/loadIsomorphicCodeVariant/hasAllCodeVariants';
import { maybeCodeInitialData } from '../pipeline/loadIsomorphicCodeVariant/maybeCodeInitialData';
import type { Code } from './types';

/**
 * The render-decision inputs for the chunk that drives `CodeHighlighter`,
 * computed from its props. These feed the generic chunk decision
 * (`resolveChunkRender` via `buildChunkRenderInputs`):
 *
 * - `preloaded` is the `Code` (build/precomputed input).
 * - `controlled` forces the `content` mode (render the client directly).
 * - `isInitial` reports that an initial paint is already in hand.
 * - `forceClient` opts out of the server `Loader`/`InitialLoader`.
 */
export interface CodeHighlighterChunkProps {
  /** The `Code` passed as the chunk's `preloaded` value. */
  preloaded?: Code;
  /**
   * Every variant is already highlighted (or `CodeHighlighter` is in controlled
   * editing mode) - render the client content directly, no loading.
   */
  controlled: boolean;
  /**
   * A partial code with an initial paint already in hand (enough to render the
   * loading fallback now). Routes to loading the full content behind it, or, with
   * no server loading, to the client.
   */
  isInitial: boolean;
  /**
   * No server loading is available for this render (no loading functions, or the
   * caller forced the client), so the decision routes to a client/content branch.
   */
  forceClient: boolean;
}

/** The `CodeHighlighter` props this decision reads. */
type BuildCodeHighlighterChunkPropsInput<T extends {}> = Pick<
  CodeHighlighter.Props<T>,
  | 'code'
  | 'precompute'
  | 'components'
  | 'variants'
  | 'variant'
  | 'initialVariant'
  | 'defaultVariant'
  | 'controlled'
  | 'forceClient'
  | 'highlightAfter'
  | 'fallbackUsesExtraFiles'
  | 'fallbackUsesAllVariants'
  | 'loadCodeMeta'
  | 'loadVariantMeta'
  | 'loadSource'
  | 'sourceParser'
  | 'sourceTransformers'
  | 'url'
  | 'fileName'
>;

/**
 * Map `CodeHighlighter`'s props onto the generic chunk render-decision inputs.
 * This replaces the bespoke `renderCodeHighlighter`/`renderWithInitialSource`
 * branching: the returned values drive `resolveChunkRender`, which picks between
 * rendering the client directly, loading the full content on the server, fetching
 * an initial on the server, or letting the client drive - the same five outcomes
 * `CodeHighlighter` chose by hand.
 *
 * Pure and synchronous (mirrors `maybeCodeInitialData`), so the same inputs decide
 * identically on the server and the client's first render. Expects `code` already
 * normalized (e.g. a string child folded into a `Default` variant).
 */
export function buildCodeHighlighterChunkProps<T extends {} = {}>(
  props: BuildCodeHighlighterChunkPropsInput<T>,
): CodeHighlighterChunkProps {
  const code = props.code || props.precompute;
  const variants = props.variants || Object.keys(props.components || code || {});
  const initialKey = props.initialVariant || props.variant || props.defaultVariant || variants[0];

  // Every variant already highlighted (or controlled editing) -> render the
  // client directly with no loading.
  const allVariantsLoaded = Boolean(code && hasAllVariants(variants, code, true));
  const controlled = Boolean(props.controlled) || allVariantsLoaded;

  // No loading functions (or the caller forced the client) -> the server cannot
  // load, so route to a client/content branch.
  const hasAnyLoaderFunction = Boolean(
    props.loadCodeMeta ||
    props.loadVariantMeta ||
    props.loadSource ||
    props.sourceParser ||
    props.sourceTransformers,
  );
  const forceClient = Boolean(props.forceClient) || !hasAnyLoaderFunction;

  // An initial paint is in hand when, short of being fully loaded,
  // `maybeCodeInitialData` validates enough to render the loading fallback now.
  // Mirrors the server arguments `CodeHighlighter` passed it (no explicit
  // `fileName`; highlight required only for `highlightAfter: 'init'`).
  let isInitial = false;
  if (!controlled) {
    const { initialData } = maybeCodeInitialData(
      variants,
      initialKey,
      code,
      undefined,
      props.highlightAfter === 'init',
      props.fallbackUsesExtraFiles,
      props.fallbackUsesAllVariants,
    );
    isInitial = Boolean(initialData);
  }

  return { preloaded: code, controlled, isInitial, forceClient };
}
