import * as React from 'react';

import type { Code, CodeHighlighterProps } from './types';
import type { CompressedFallback } from './fallbackFormat';
import { maybeCodeInitialData } from '../pipeline/loadIsomorphicCodeVariant/maybeCodeInitialData';
import { getFileNameFromUrl, getLanguageFromExtension } from '../pipeline/loaderUtils';
import { buildCodeHighlighterChunkProps } from './buildCodeHighlighterChunkProps';
import { prepareInitialSource } from './prepareInitialSource';
import { CodeHighlighterChunk } from './CodeHighlighterChunk';
import type { CodeHighlighterChunkUserProps } from './CodeHighlighterChunk';
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
export function CodeHighlighter<T extends {}>(props: CodeHighlighterProps<T>): React.ReactElement {
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
      code: props.loadPrecompute ? undefined : options.preloaded,
      precompute: props.loadPrecompute ? options.preloaded : props.precompute,
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
