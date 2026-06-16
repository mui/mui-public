import * as React from 'react';

import type {
  Code,
  Components,
  ContentProps,
  ContentLoadingProps,
  LoadCodeMeta,
  LoadVariantMeta,
  LoadSource,
  SourceTransformers,
  ParseSource,
  SourceEnhancers,
} from './types';
import type { CompressedFallback } from './fallbackFormat';
import { maybeCodeInitialData } from '../pipeline/loadIsomorphicCodeVariant/maybeCodeInitialData';
import { getFileNameFromUrl, getLanguageFromExtension } from '../pipeline/loaderUtils';
import { buildCodeHighlighterChunkProps } from './buildCodeHighlighterChunkProps';
import { prepareInitialSource } from './prepareInitialSource';
import { CodeHighlighterChunk, type CodeHighlighterChunkUserProps } from './CodeHighlighterChunk';
import * as Errors from './errors';

const DEBUG = false; // Set to true for debugging purposes

/**
 * Isomorphic entry for a code block. Validates and normalizes props, then maps them
 * onto the generic {@link CodeHighlighterChunk} (a `createCoordinatedLazy` chunk):
 * the decision inputs (`controlled`/`isInitial`/`forceClient`) computed by
 * {@link buildCodeHighlighterChunkProps} route between rendering the client directly
 * (precomputed content), dynamically importing the server `Loader` (load all
 * variants), or the server `InitialLoader` (load a quick initial first). When a
 * `ContentLoading` and an initial paint are available, the loading fallback +
 * compressed residual are prepared up front via {@link prepareInitialSource}.
 *
 * The heavy load/parse pipeline lives behind the dynamically-imported loaders, so it
 * never reaches the path that renders precomputed content.
 */
export function CodeHighlighter<T extends {}>(props: CodeHighlighter.Props<T>): React.ReactElement {
  // Validate mutually exclusive props
  if (props.children && (props.code || props.precompute)) {
    throw new Errors.ErrorCodeHighlighterServerInvalidProps();
  }

  // Handle children as string -> Default variant
  let code = props.code;
  if (props.children && typeof props.children === 'string') {
    const fileName =
      props.fileName || (props.url ? getFileNameFromUrl(props.url).fileName : undefined);
    // Derive language: use explicit prop, or derive from fileName extension
    let language = props.language;
    if (!language && fileName) {
      const extension = fileName.slice(fileName.lastIndexOf('.'));
      language = getLanguageFromExtension(extension);
    }
    code = {
      Default: {
        fileName,
        language,
        source: props.children,
        url: props.url,
      },
    };
  }

  const variants =
    props.variants || Object.keys(props.components || code || props.precompute || {});
  if (variants.length === 0) {
    throw new Errors.ErrorCodeHighlighterServerMissingData();
  }

  // Validate fileName is provided when extraFiles are present
  if (code) {
    for (const [variantName, variantCode] of Object.entries(code)) {
      if (
        typeof variantCode === 'object' &&
        variantCode?.extraFiles &&
        Object.keys(variantCode.extraFiles).length > 0 &&
        !variantCode.fileName &&
        !variantCode.url
      ) {
        throw new Errors.ErrorCodeHighlighterServerMissingFileName(variantName);
      }
    }
  }

  const ContentLoading = props.ContentLoading;
  const initialKey = props.initialVariant || props.variant || props.defaultVariant || variants[0];

  // Map the props onto the chunk decision inputs (replaces the bespoke
  // renderCodeHighlighter/renderWithInitialSource branching).
  const { controlled, isInitial, forceClient } = buildCodeHighlighterChunkProps({ ...props, code });

  // Render the chunk. `controlled`/`isInitial`/`forceClient` drive the decision; a
  // prepared `fallback`/`residualFallbacks` (and the wire `Code` as `preloaded`) are
  // threaded through when an initial paint was available up front.
  const renderChunk = (options: {
    preloaded?: Code;
    fallback?: React.ReactNode;
    residualFallbacks?: CompressedFallback;
  }): React.ReactElement => {
    const userProps = {
      ...props,
      code: options.preloaded,
      ContentLoading,
      initialVariant: initialKey,
      fallback: options.fallback,
      residualFallbacks: options.residualFallbacks,
      // The user's content generic is erased at the chunk boundary; the real props
      // ride through `Content`/`contentProps` and are rebuilt by `createClientProps`.
    } as unknown as CodeHighlighterChunkUserProps;

    return (
      <CodeHighlighterChunk
        preloaded={options.preloaded}
        controlled={controlled}
        isInitial={isInitial}
        forceClient={forceClient}
        // No ContentLoading -> no fallback to paint an initial into, so skip the
        // initial-loader stage and load the full content directly.
        skipInitialLoad={!ContentLoading}
        // Stream the fallback (Suspense) only when streaming the full load behind an
        // already-in-hand initial; otherwise block on the loader so its content is in
        // the initial HTML (the server-initial loader streams its own 2nd stage).
        awaitServerLoad={!(isInitial && props.highlightAfter === 'stream')}
        userProps={userProps}
      />
    );
  };

  // No ContentLoading: render the content/full-load directly, with no loading
  // fallback (the client shows nothing until content is ready). For
  // `highlightAfter: 'init'`, `createClientProps` folds each variant's highlighted-visible
  // `fallbackCritical` over its plain `fallback`, so `<Pre>` paints the visible frames
  // highlighted on the first render (no decompression) and decodes the full tree after
  // paint (the `decodeAllowed` latch).
  if (!ContentLoading) {
    if (props.highlightAfter === 'stream') {
      // `highlightAfter: 'stream'` needs a ContentLoading component to stream into.
      throw new Errors.ErrorCodeHighlighterServerMissingContentLoading();
    }
    return renderChunk({ preloaded: code });
  }

  const initial = code?.[initialKey] || props.precompute?.[initialKey];
  if (!initial && !props.components?.[initialKey]) {
    throw new Errors.ErrorCodeHighlighterServerMissingVariant(initialKey);
  }

  // TODO: use initial.filesOrder to determine which source to use
  const { initialData, reason } = maybeCodeInitialData(
    variants,
    initialKey,
    code || props.precompute,
    undefined, // TODO: use initial.filesOrder if provided?
    props.highlightAfter === 'init',
    props.fallbackUsesExtraFiles,
    props.fallbackUsesAllVariants,
  );

  // No initial paint in hand: either the client takes over (no loader fns / forced
  // client), or the server initial loader fetches a quick initial first.
  if (!initialData) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.log('Initial data not found:', reason);
    }
    if (forceClient && props.highlightAfter === 'init') {
      throw new Errors.ErrorCodeHighlighterServerInvalidClientMode();
    }
    return renderChunk({ preloaded: code });
  }

  // Initial paint in hand: prepare the loading fallback + compressed residual, and
  // send the wire `Code` as the preloaded value.
  const { fallback, residualFallbacks, codeForClient } = prepareInitialSource({
    ...props,
    code: initialData.code,
    initialVariant: initialKey,
    initialFilename: initialData.initialFilename,
    initialSource: initialData.initialSource,
    initialExtraFiles: initialData.initialExtraFiles,
    ContentLoading,
    // Compressing the residual fallbacks only shrinks the server→client payload. This
    // entry is isomorphic, so when it runs on the client (e.g. a Pages-Router app that
    // renders everything client-side) there is no wire — skip the compress and keep the
    // fallbacks inline rather than compressing them only to decompress them right back.
    compressResidual: typeof window === 'undefined',
  });
  return renderChunk({ preloaded: codeForClient, fallback, residualFallbacks });
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CodeHighlighter {
  /**
   * Props for the {@link CodeHighlighter} component.
   * Supports both build-time precomputation and runtime code loading with extensive
   * customization options. Generic `T` flows custom props into `Content`/`ContentLoading`.
   */
  export interface Props<T extends {} = {}> {
    /** Display name for the code example, used for identification and titles */
    name?: string;
    /** URL-friendly identifier for deep linking and navigation */
    slug?: string;
    /** Source URL where the code content originates from */
    url?: string;

    /** Static code content with variants and metadata */
    code?: Code;
    /** React components for live preview alongside code */
    components?: Components;
    /** What type of variants are available (e.g., a type `packageManager` when variants `npm` and `yarn` are available) */
    variantType?: string;
    /** Static variant names that should be fetched at runtime */
    variants?: string[];
    /** Currently selected variant name */
    variant?: string;
    /** Currently selected file name */
    fileName?: string;
    /** Language for syntax highlighting (e.g., 'tsx', 'css'). When provided, fileName is not required for parsing. */
    language?: string;
    /** Default variant to show on first load */
    initialVariant?: string;
    /** Fallback variant when the requested variant is not available */
    defaultVariant?: string;
    /** Global static code snippets to inject, typically for styling or tooling */
    globalsCode?: Array<Code | string>;

    /** Pre-computed code data from build-time optimization */
    precompute?: Code;
    /** Whether fallback content should include extra files */
    fallbackUsesExtraFiles?: boolean;
    /** Whether fallback content should include all variants */
    fallbackUsesAllVariants?: boolean;
    /**
     * Paint only the collapsed window in the `ContentLoading` fallback and defer
     * each file's full fallback into the compressed payload. Shrinks the initial
     * HTML of a collapsed block to its on-screen lines, but removes the hidden
     * lines from the server-rendered markup — so it is **only** appropriate for
     * content that will not be crawled (authenticated or internal pages). See the
     * prop-compression pattern's "Splitting the Fallback by Visibility".
     * @default false
     */
    fallbackCollapsed?: boolean;
    /** Enable controlled mode for external code state management */
    controlled?: boolean;
    /**
     * When the live-editing engine loads for an editable block:
     *   - `'eager'` (default): load it as soon as the block is editable, and let
     *     `CodeHighlighter` speculatively preload it on first render.
     *   - `'interaction'`: defer the load until the reader hovers, focuses, or
     *     clicks the code, and suppress the speculative preload — so a block the
     *     reader never engages does not fetch the engine chunk at all.
     *
     * Only meaningful for editable blocks (a `CodeControllerContext` exposing
     * `setCode`); ignored otherwise.
     * @default 'eager'
     */
    editActivation?: 'eager' | 'interaction';
    /** Raw code string for simple use cases */
    children?: string;
    /**
     * When to perform syntax highlighting and code processing
     * @default 'idle'
     */
    highlightAfter?: 'init' | 'stream' | 'hydration' | 'idle';
    /**
     * When to enhance the code display with interactivity
     * @default 'idle'
     */
    enhanceAfter?: 'init' | 'stream' | 'hydration' | 'idle';
    /** Force client-side rendering even when server rendering is available */
    forceClient?: boolean;
    /** Defer parsing and populating the AST into memory until the code is enhanced
     * Applies only in production when RSC loading
     * @default 'gzip'
     */
    deferParsing?: 'none' | 'json' | 'gzip';

    /** Function to load code metadata from a URL */
    loadCodeMeta?: LoadCodeMeta;
    /** Function to load specific variant metadata */
    loadVariantMeta?: LoadVariantMeta;
    /** Function to load raw source code and dependencies */
    loadSource?: LoadSource;
    /** Array of source transformers for code processing (e.g., TypeScript to JavaScript) */
    sourceTransformers?: SourceTransformers;
    /** Promise resolving to a source parser for syntax highlighting */
    sourceParser?: Promise<ParseSource>;
    /** Array of source enhancers that run after parsing to enhance the HAST tree */
    sourceEnhancers?: SourceEnhancers;
    /**
     * Optional URL-prefix rewrite forwarded to {@link LoadFileOptions.urlPrefix}.
     * Lets the demo factory translate local `file://` URLs returned by
     * `loadSource` into hosted URLs before they reach the client.
     */
    urlPrefix?: { from: string; to: string };

    /** Component to render the code content and preview */
    Content: React.ComponentType<ContentProps<T>>;
    /** Additional props passed to the Content component */
    contentProps?: T;

    /**
     * Render-time "collapse to empty": collapse the code block to an empty window so
     * the whole block is hidden until expanded. Threaded into `contentProps` and
     * consumed by `useCode`/`<Pre>`. Runtime-only — the precomputed HAST is
     * unchanged.
     */
    collapseToEmpty?: boolean;
    /**
     * Whether the (collapsible) code block starts expanded. Threaded into
     * `contentProps` so both `useCode` and the loading fallback honor it.
     */
    initialExpanded?: boolean;
    /** Component to show while code is being loaded or processed */
    ContentLoading?: React.ComponentType<ContentLoadingProps<T>>;
  }
}
