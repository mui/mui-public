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
  /**
   * The content calls this once it has loaded (its dynamic import resolved), so
   * the swap can register readiness with the settle gate. Used by `LazyContent`.
   */
  reportReady?: () => void;
  /**
   * The loading fallback to show *while a dynamically-imported content loads*.
   * After the swap reveals the content, a `LazyContent` shows this as its own
   * Suspense fallback during the `import()` - so the same placeholder the swap
   * showed keeps covering the load, with no empty flash. Generalizes "hand the
   * `ContentLoading` to the lazy content".
   */
  fallback?: React.ReactNode;
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
  /**
   * Hold the settle gate open WITHOUT re-showing the fallback - the content stays
   * rendered while the page-wide coordination waits. Unlike `defer` (which holds
   * the rendered fallback), this only affects gate registration, for content that
   * has swapped in but is still finishing deferred work it gates internally (e.g.
   * the code highlighter rendering plain text, then highlighting in place).
   */
  holdGate?: boolean;
  /** Whether a fallback element exists to show. */
  hasFallback: boolean;
  /** Skip the fallback entirely. */
  skipFallback?: boolean;
  /** Additionally hold the swap until the fallback hoists at least once. */
  requireHoist?: boolean;
  /**
   * Hold the swap until the content reports it has loaded. The consumer mounts
   * the content (e.g. a `LazyContent`) while the fallback is shown so it can
   * load in the background, returning `null` until ready and then calling the
   * content context's `reportReady` - so a code-split content component loads
   * behind the placeholder and reveals only once its chunk has arrived.
   */
  awaitContent?: boolean;
  /**
   * Settle gate to register this swap with. When omitted, the ambient gate from
   * a surrounding coordinator (e.g. the `useStream` controller, via
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
  /** In `awaitContent` mode, whether the content has reported it loaded. */
  contentReady: boolean;
  /** Passed to the content (via the content context) so it can report it loaded. */
  reportContentReady: () => void;
  /**
   * Hoist a keyed value up to the swap directly (the same channel the fallback's
   * `useCoordinatedFallback` uses). Lets the consumer populate the hoisted map
   * from outside the fallback subtree - e.g. a client-loaded data path that has
   * no fallback mounted but still needs to feed the hoisted dictionary.
   */
  hoist: (key: string, value: unknown) => void;
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
  /**
   * Hold the settle gate open without re-showing the fallback (content stays
   * rendered). See {@link UseCoordinatedSwapOptions.holdGate}.
   */
  holdGate?: boolean;
  /** Skip the fallback entirely. */
  skipFallback?: boolean;
  /** Hold the swap until the fallback hoists at least once. */
  requireHoist?: boolean;
  /**
   * Hold the swap until the content reports it has loaded, mounting the content
   * behind the fallback so a code-split (e.g. `LazyContent`) content can load in
   * the background and reveal only once its chunk has arrived. See
   * {@link UseCoordinatedSwapOptions.awaitContent}.
   */
  awaitContent?: boolean;
  /**
   * Settle gate to register this swap with. When omitted, the ambient gate from
   * a surrounding coordinator (e.g. the `useStream` controller, via
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
// A "chunk" here is one unit of loaded data; `useStream` streams a list of them.
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
  /**
   * Re-run the chunk's `data`-mode loader and swap in fresh data, keeping the
   * current data visible meanwhile (stale-while-revalidate). Client-only; a
   * no-op for non-`data` sources. Provided by the framework's client renderer.
   */
  refresh?: () => Promise<void>;
  /** `true` while a background refresh is in flight (the current data stays). */
  revalidating?: boolean;
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
export interface StreamUrlsResult {
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
export type StreamSource<P = unknown, O = unknown> =
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
      loadUrls: (options: O, signal: AbortSignal) => Promise<StreamUrlsResult>;
      /** Load one chunk's data from its URL. */
      loadChunk: (url: URL, options: O, signal: AbortSignal) => Promise<P>;
      /** Optional initial URL set for a quick first paint. */
      initialUrls?: (options: O) => StreamUrlsResult;
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
  /**
   * Data source (discriminated by `mode`). Its loader functions run **on the
   * server only** - a `data`-mode source is executed by `ChunkServerLoader`
   * (`source.load` for the full content, `source.initial` for a quick streamed
   * paint) and never serialized into a Client Component. To load on the *client*,
   * supply the source through a {@link ChunkProvider} (which lazily imports it)
   * rather than this field. (Calling `useChunk` directly inside your own client
   * component with a `source` is still fine - no server/client boundary is
   * crossed there.)
   */
  source?: StreamSource<P, O>;
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
  /**
   * The `ChunkContent` component performs its own client-side loading and
   * fallback->content swap. When set, the client-driven render modes render
   * `ChunkContent` directly (with `loading: true`) instead of wrapping it in the
   * framework's {@link useChunk}+swap (`CoordinatedLazyClient`) - so a
   * self-managing content (e.g. one already built on `useCoordinatedSwap`) is not
   * double-swapped. Server and content/`content-initial` modes are unaffected.
   */
  contentManagesSwap?: boolean;
  /**
   * Opt into stale-while-revalidate: once the chunk has loaded, automatically
   * re-run the loader once on the first idle period (via `requestIdleCallback`)
   * to refresh potentially-stale data in the background. Client-only. The chunk
   * keeps showing its current data while the refresh is in flight.
   */
  revalidateOnIdle?: boolean;
}

/**
 * The chunk config without the server-only loader functions
 * (`source`/`Loader`/`InitialLoader`). This is what the `'use client'`
 * {@link CoordinatedLazyClient} accepts: `createCoordinatedLazy` strips those
 * fields before constructing the client element, so the type system guarantees
 * no loader function is ever serialized across the server/client boundary. A
 * client-loaded chunk gets its source from a {@link ChunkProvider} in context,
 * not from this config.
 */
export type ClientChunkConfig<T extends {} = {}, P = unknown, O = unknown> = Omit<
  CreateChunkConfig<T, P, O>,
  'source' | 'Loader' | 'InitialLoader'
>;

/** The branch of the render decision that applies for a chunk. */
export type ChunkRenderMode =
  | 'content' // isLoaded (or controlled): render ChunkContent (loading false)
  | 'content-initial' // isInitial (initial already in hand), no full loader: render ChunkContent (loading), the content owns the swap
  | 'server-initial' // no initial in hand + a server initial (InitialLoader or data-source initial): render the quick initial on the server
  | 'server-loader' // a server full loader (Loader or data-source load): render the full content on the server
  | 'attempt-initial-client'; // no server provider: render initial data; the client loads it (via a ChunkProvider source)

/** Already-evaluated inputs to `resolveChunkRender` (decoupled from config shape). */
export interface ChunkRenderInputs {
  /** Evaluated `isLoaded(preloaded)` (or the controlled override). */
  isLoaded: boolean;
  /** Evaluated `isInitial(preloaded)`. */
  isInitial: boolean;
  /** A server initial is configured: an `InitialLoader`, or a `data`-mode `source.initial`. */
  hasServerInitial: boolean;
  /** A server full loader is configured: a `Loader`, or a `data`-mode `source.load`. */
  hasServerLoader: boolean;
}

/** Result of `resolveChunkRender`. */
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
  /**
   * Force client-side rendering: ignore the server `Loader`/`InitialLoader` for
   * this render so the decision routes to a content/client branch instead. Lets
   * a consumer that *configures* server loaders statically opt out of them
   * per-render (e.g. when no server loading functions are available, or the
   * caller explicitly wants the client to drive). Has no effect once
   * `isLoaded`/`controlled` already render the content.
   */
  forceClient?: boolean;
  /**
   * Per-render override for the `isInitial` decision input (whether the initial
   * paint is already in hand). Mirrors how `controlled` overrides `isLoaded`:
   * lets a consumer whose initial-readiness depends on per-render context it
   * cannot express as a pure `config.isInitial(preloaded)` predicate compute it
   * in its own router and pass the result. Takes precedence over
   * `config.isInitial`.
   */
  isInitial?: boolean;
  /**
   * For the server render modes (`server-loader`/`server-initial`), block the
   * server render on the loader instead of streaming a fallback: render the
   * server loader *without* a Suspense boundary, so its content lands in the
   * initial HTML (e.g. for no-JS / crawler SSR). When unset (the default) the
   * loader streams under Suspense, showing `ChunkLoading` until it resolves.
   */
  awaitServerLoad?: boolean;
  /**
   * Skip the initial-loader stage: ignore the `InitialLoader` / source-`initial`
   * for this render so a not-yet-loaded chunk loads the full content directly
   * rather than fetching a quick initial first. For consumers that have no
   * loading UI to show an initial paint into (so a 2-stage initial->full load
   * would be wasted).
   */
  skipInitialLoad?: boolean;
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
   * and mounted (e.g. a `useStream` controller gate). The page-global gate is
   * always registered too. Client path only - the server path streams via
   * Suspense and has no client gate to report to.
   */
  gate?: SettleGate;
}
