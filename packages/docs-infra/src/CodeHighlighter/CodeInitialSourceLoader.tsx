import * as React from 'react';
import type { CodeHighlighterChunkContentProps } from './CodeHighlighterChunk';
import { CodeHighlighterChunk } from './CodeHighlighterChunk';
import { buildCodeHighlighterChunkProps } from './buildCodeHighlighterChunkProps';
import { prepareInitialSource } from './prepareInitialSource';
import type { PrepareInitialSourceOptions } from './prepareInitialSource';
// Statically imported because this whole module is dynamically imported by
// `CodeHighlighterChunk` (`() => import('./CodeInitialSourceLoader')`) only when
// the render decision routes to the initial loader - so `loadCodeFallback` already
// lives in this lazy chunk and never reaches the precomputed-content path.
import { loadCodeFallback } from '../pipeline/loadIsomorphicCodeVariant/loadCodeFallback';
import * as Errors from './errors';

/**
 * The chunk's **server initial loader**: load just the initial source (a quick
 * fallback paint) via `loadCodeFallback`, prepare the loading fallback + compressed
 * residual from it, then **re-enter the chunk** with the initial in hand
 * (`skipInitialLoad`, so it routes to the full server loader or the client - never
 * back here). Dynamically imported by `CodeHighlighterChunk`.
 */
export default async function CodeInitialSourceLoader(
  props: CodeHighlighterChunkContentProps,
): Promise<React.ReactElement> {
  const { data, loading, ...userProps } = props;
  const { url, initialVariant, highlightAfter, ContentLoading } = userProps;

  if (!url) {
    throw new Errors.ErrorCodeHighlighterServerMissingUrl();
  }
  if (!initialVariant) {
    throw new Errors.ErrorCodeHighlighterServerMissingVariant('initial');
  }

  let output: 'hast' | 'hastJson' | 'hastCompressed' = 'hastCompressed';
  if (userProps.deferParsing === 'json') {
    output = 'hastJson';
  } else if (userProps.deferParsing === 'none') {
    output = 'hast';
  }

  const { code, initialFilename, initialSource, initialExtraFiles, processedGlobalsCode } =
    await loadCodeFallback(url, initialVariant, data ?? userProps.code, {
      shouldHighlight: highlightAfter === 'init',
      fallbackUsesExtraFiles: userProps.fallbackUsesExtraFiles,
      fallbackUsesAllVariants: userProps.fallbackUsesAllVariants,
      sourceParser: userProps.sourceParser,
      loadSource: userProps.loadSource,
      loadVariantMeta: userProps.loadVariantMeta,
      loadCodeMeta: userProps.loadCodeMeta,
      sourceEnhancers: userProps.sourceEnhancers,
      initialFilename: userProps.fileName,
      variants: userProps.variants,
      globalsCode: userProps.globalsCode,
      output,
      urlPrefix: userProps.urlPrefix,
    });

  // Prepare the loading fallback + compressed residual from the loaded initial.
  const { fallback, residualFallbacks, codeForClient } = prepareInitialSource({
    ...userProps,
    code,
    initialVariant,
    initialFilename,
    initialSource,
    initialExtraFiles,
    ContentLoading: ContentLoading!,
  } as PrepareInitialSourceOptions<{}>);

  // Re-enter the chunk with the initial in hand. `skipInitialLoad` prevents routing
  // back here; the recomputed decision loads the full content on the server (when
  // loader functions exist) or hands off to the client.
  const { controlled, isInitial, forceClient } = buildCodeHighlighterChunkProps({
    ...userProps,
    code: codeForClient,
  });

  return (
    <CodeHighlighterChunk
      preloaded={codeForClient}
      controlled={controlled}
      isInitial={isInitial}
      forceClient={forceClient}
      skipInitialLoad
      awaitServerLoad={highlightAfter !== 'stream'}
      userProps={{
        ...userProps,
        code: codeForClient,
        fallback,
        residualFallbacks,
        processedGlobalsCode,
        initialVariant,
      }}
    />
  );
}
