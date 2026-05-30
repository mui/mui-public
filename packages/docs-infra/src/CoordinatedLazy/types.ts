import type * as React from 'react';
import type { SettleGate } from '../useCoordinated/createSettleGate';

/**
 * Provided by a {@link CoordinatedLazy} to its fallback subtree while the
 * fallback is shown. Carries the upward hoist channel and the
 * nested-suppression flag. Generalizes `CodeHighlighterFallbackContext`
 * (`{ extraVariants, setFallbackHasts, onHookCalled }`).
 */
export interface CoordinatedFallbackContextValue {
  /**
   * Hoist a keyed value up to the swap so it can be folded into the consumer's
   * `ready` decision and handed down to the full content via
   * {@link CoordinatedContentContextValue}. Generalizes `setFallbackHasts`.
   */
  hoist?: (key: string, value: unknown) => void;
  /**
   * Signal that the fallback's hoist hook ran. The generic swap force-mounts
   * the fallback on its own, so this is optional - consumers (e.g.
   * `CodeHighlighter`) use it to validate that the loading component wired its
   * hoist hook. Generalizes `onHookCalled`.
   */
  onReady?: () => void;
  /**
   * `true` when this instance is nested inside an outer `CoordinatedLazy` still
   * showing its own fallback. The inner stays in fallback while set, collapsing
   * a "fallback -> content -> fallback -> content" flicker into one transition.
   * Generalizes `isNestedInsideOuterFallback`.
   */
  isNested?: boolean;
  /** Arbitrary parent->fallback data (generalizes `extraVariants`). */
  data?: Record<string, unknown>;
}

/**
 * The data the fallback hoisted, handed down to the full content so it can use
 * what the fallback fetched (e.g. a DEFLATE dictionary). Read via
 * {@link useCoordinatedContent}.
 */
export interface CoordinatedContentContextValue {
  hoisted: Record<string, unknown>;
}

/** Result of {@link useCoordinatedFallback}. */
export interface UseCoordinatedFallbackResult {
  /** Parent->fallback data provided via {@link CoordinatedFallbackContextValue.data}. */
  data?: Record<string, unknown>;
  /** Whether this fallback's `CoordinatedLazy` is nested inside an outer, still-loading one. */
  isNested: boolean;
}

/** Options for {@link useCoordinatedSwap}. */
export interface UseCoordinatedSwapOptions {
  /** Whether the content's data is ready to display. */
  ready: boolean;
  /** Hold the swap while real async work is still in flight even though `ready`. */
  defer?: boolean;
  /** Whether a fallback element exists to show. */
  hasFallback: boolean;
  /** Skip the fallback entirely. */
  skipFallback?: boolean;
  /** Additionally hold the swap until the fallback hoists at least once. */
  requireHoist?: boolean;
  /**
   * Settle gate to register this swap with. When omitted, the ambient gate from
   * a surrounding coordinator (e.g. the `useChunks` controller, via
   * {@link CoordinatedGateContext}) is used instead. The page-global gate is
   * always registered on top of either, so a page-wide coordinated commit waits
   * for the swap regardless.
   */
  gate?: SettleGate;
  /** Arbitrary parent->fallback data exposed via the fallback context. */
  data?: Record<string, unknown>;
  /**
   * Fired as soon as the fallback hoists data, with the hoisted map. Lets the
   * consumer kick off dynamic `import()`s of heavy helpers it can tell from the
   * data it will need - in parallel with loading the full content, instead of
   * the content mounting and then requesting them in a serial roundtrip. Should
   * be idempotent (the module cache dedups within a graph); cross-instance
   * dedup is the layout provider's job.
   */
  preload?: (hoisted: Record<string, unknown>) => void;
}

/** Result of {@link useCoordinatedSwap}. */
export interface UseCoordinatedSwapResult {
  /** Whether the fallback branch should mount this render. */
  showFallback: boolean;
  /** Context value to provide to the fallback subtree. */
  fallbackContext: CoordinatedFallbackContextValue;
  /** Data hoisted up from the fallback so far, keyed. */
  hoisted: Record<string, unknown>;
  /** `true` while the fallback is being shown. */
  loading: boolean;
}

/** Props for {@link CoordinatedLazy}. */
export interface CoordinatedLazyProps {
  /** Full content, shown after the swap. Pre-rendered on the server. */
  content: React.ReactNode;
  /** Loading placeholder; force-mounted once so its hoist hook runs. */
  fallback?: React.ReactNode;
  /** Whether the content's data is ready to display. */
  ready: boolean;
  /** Hold the swap while real async work is in flight even though `ready`. */
  defer?: boolean;
  /** Skip the fallback entirely. */
  skipFallback?: boolean;
  /** Hold the swap until the fallback hoists at least once. */
  requireHoist?: boolean;
  /**
   * Settle gate to register this swap with. When omitted, the ambient gate from
   * a surrounding coordinator (e.g. the `useChunks` controller, via
   * {@link CoordinatedGateContext}) is used instead. The page-global gate is
   * always registered on top of either, so a page-wide coordinated commit waits
   * for the swap regardless.
   */
  gate?: SettleGate;
  /** Arbitrary parent->fallback data exposed to the fallback subtree. */
  data?: Record<string, unknown>;
  /**
   * Speculative preload hook. See {@link UseCoordinatedSwapOptions.preload}:
   * fired with the hoisted data so the consumer can start dynamic imports of
   * helpers in parallel with loading the full content.
   */
  preload?: (hoisted: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Self-loading coordinated-lazy (`createCoordinatedLazy`) + its building blocks.
// A "chunk" here is one unit of loaded data; `useChunks` streams a list of them.
// ---------------------------------------------------------------------------

/**
 * A dynamic import of a component, in the standard `() => import('./X')` shape.
 * The imported module's `default` export is the component. The component may be
 * authored as a server OR client component: on the client it is only ever
 * rendered when the consumer routed to the client path, and a server-only
 * component should resolve (via a conditional export) to a client stub that
 * throws if rendered - so importing it is harmless, only execution is guarded.
 */
export type LazyComponentImport<T> = () => Promise<{ default: React.ComponentType<T> }>;

/**
 * Props the full chunk content receives. Mirrors `ContentProps<T>`: the user's
 * generic props `T` are merged in, plus the resolved `data` (of type `P`) and a
 * `loading` flag (`false` once the full data is in).
 */
export type ChunkContentProps<T extends {} = {}, P = unknown> = {
  data?: P;
  loading: boolean;
} & T;

/**
 * Props the loading placeholder receives. Mirrors `ContentLoadingProps<T>`:
 * `loading` is always `true`, and `data` carries whatever initial/preloaded
 * value is available (of type `P`).
 */
export type ChunkLoadingProps<T extends {} = {}, P = unknown> = {
  data?: P;
  loading: true;
} & T;

/** Decide whether the preloaded value is enough to render the full content. */
export type IsLoaded<P = unknown> = (preloaded: P | undefined) => boolean;
/** Decide whether the preloaded value is enough to render the initial state. */
export type IsInitial<P = unknown> = (preloaded: P | undefined) => boolean;

/**
 * Result of a `urls`-mode loader: the chunk URLs to load individually, rather
 * than the data itself. `lastChunk` marks the final URL for last-chunk
 * completion when the total isn't known up front.
 */
export interface ChunkUrlsResult {
  chunks: URL[];
  lastChunk?: boolean;
}

/**
 * Where a chunk's data comes from - a **discriminated union** on `mode`, so
 * each strategy is strongly typed with no overloads or runtime return-type
 * sniffing:
 *
 * - `'data'` - load the chunk's data directly (optionally with a quick
 *   `initial` value first).
 * - `'urls'` - split into per-chunk URLs (`loadUrls`), then load each URL's
 *   data (`loadChunk`); supports an initial pass.
 * - `'stream'` - push chunks into the passed array over time and `yield` after
 *   each, for progressive reveal (the generator's return is the last-chunk
 *   signal).
 */
export type ChunkSource<P = unknown, O = unknown> =
  | {
      mode: 'data';
      /** Load the chunk's full data. */
      load: (options: O, signal: AbortSignal) => Promise<P>;
      /** Optional quick initial value rendered before the full load resolves. */
      initial?: (options: O) => P;
    }
  | {
      mode: 'urls';
      /** Resolve the per-chunk URLs (not the data) for the full content. */
      loadUrls: (options: O, signal: AbortSignal) => Promise<ChunkUrlsResult>;
      /** Load one chunk's data from its URL. */
      loadChunk: (url: URL, options: O, signal: AbortSignal) => Promise<P>;
      /** Optional initial URL set for a quick first paint. */
      initialUrls?: (options: O) => ChunkUrlsResult;
      /** Optional initial loader for a single chunk URL. */
      initialChunk?: (url: URL, options: O) => P;
    }
  | {
      mode: 'stream';
      /**
       * Push chunks into `chunks` and `yield` after each; returning ends the
       * stream (last-chunk completion). Runs on the client (incremental
       * `setState`) and as the isomorphic driver the server awaits.
       */
      stream: (chunks: P[], options: O, signal: AbortSignal) => AsyncGenerator<void, void, void>;
    };

/** Swap timing forwarded to the underlying `CoordinatedLazy`. */
export interface ChunkSwapConfig {
  defer?: boolean;
  requireHoist?: boolean;
  channelKey?: string | null;
}

/** Configuration for {@link createCoordinatedLazy}. */
export interface CreateChunkConfig<T extends {} = {}, P = unknown, O = unknown> {
  /** The full content component. */
  ChunkContent: React.ComponentType<ChunkContentProps<T, P>>;
  /** The loading placeholder. Defaults to a component that renders `null`. */
  ChunkLoading?: React.ComponentType<ChunkLoadingProps<T, P>>;
  /** Whether the preloaded value suffices for the full content. */
  isLoaded?: IsLoaded<P>;
  /** Whether the preloaded value suffices for the initial state. */
  isInitial?: IsInitial<P>;
  /** Isomorphic data source (discriminated by `mode`). */
  source?: ChunkSource<P, O>;
  /**
   * Server component rendered (under Suspense) to produce the full content.
   * Always dynamically imported, and only imported when the render decision
   * routes to it - so it never reaches the client bundle.
   */
  Loader?: LazyComponentImport<ChunkContentProps<T, P>>;
  /** Server component rendered (under Suspense) to produce the initial state. */
  InitialLoader?: LazyComponentImport<ChunkContentProps<T, P>>;
  /** Swap timing forwarded to `CoordinatedLazy`. */
  swap?: ChunkSwapConfig;
  /** Default options passed to the source loaders. */
  loaderOptions?: O;
}

/** The branch of the render decision that applies for a chunk. */
export type ChunkRenderMode =
  | 'content' // isLoaded (or controlled): render ChunkContent
  | 'server-initial' // isInitial + InitialLoader: dynamic-import the server initial loader
  | 'async-initial' // isInitial + source initial: load the initial value in an async component
  | 'null-client' // isInitial, no initial provider: render null; the client loads it
  | 'server-loader' // not initial + Loader: dynamic-import the server loader
  | 'async-loader' // not initial + source: load in an async component
  | 'attempt-initial-client'; // no loader provider: render initial data; the client loads it

/** Already-evaluated inputs to {@link resolveChunkRender} (decoupled from config shape). */
export interface ChunkRenderInputs {
  /** Evaluated `isLoaded(preloaded)` (or the controlled override). */
  isLoaded: boolean;
  /** Evaluated `isInitial(preloaded)`. */
  isInitial: boolean;
  /** An `InitialLoader` server component is configured. */
  hasServerInitial: boolean;
  /** The source provides an initial value (`data.initial` / `urls.initialUrls`). */
  hasSourceInitial: boolean;
  /** A `Loader` server component is configured. */
  hasServerLoader: boolean;
  /** The source provides a full loader (any `mode`). */
  hasSourceLoader: boolean;
}

/** Result of {@link resolveChunkRender}. */
export interface ChunkRenderDecision {
  mode: ChunkRenderMode;
  loading: boolean;
}

/** Props accepted by the component returned from {@link createCoordinatedLazy}. */
export interface ChunkComponentProps<T extends {} = {}, P = unknown, O = unknown> {
  /** Build-time/precomputed value for this chunk. */
  preloaded?: P;
  /** Authoritative/controlled value: render content directly, never the loaders. */
  controlled?: boolean;
  /** Per-render loader options (merged over the config's `loaderOptions`). */
  loaderOptions?: O;
  /** User generic props forwarded to `ChunkContent` / `ChunkLoading`. */
  userProps?: T;
  /** Settle gate to register with (defaults to the surrounding controller / page). */
  gate?: SettleGate;
}

/** Props for `LazyContent` / `LazyContentServer`. */
export interface LazyContentProps<T extends {} = {}> {
  /** Dynamic import of the component to render. */
  content: LazyComponentImport<T>;
  /** Props forwarded to the imported component. */
  props?: T;
  /** Placeholder shown while the module loads. Defaults to `null`. */
  fallback?: React.ReactNode;
  /**
   * Additional settle gate to report readiness to once the component has loaded
   * and mounted (e.g. a `useChunks` controller gate). The page-global gate is
   * always registered too. Client path only - the server path streams via
   * Suspense and has no client gate to report to.
   */
  gate?: SettleGate;
}
