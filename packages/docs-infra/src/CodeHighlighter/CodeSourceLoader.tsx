import * as React from 'react';
import type { Code, VariantCode } from './types';
import type { CodeHighlighterChunkContentProps } from './CodeHighlighterChunk';
import { createClientProps, type CreateClientPropsOptions } from './createClientProps';
import { CodeHighlighterClient } from './CodeHighlighterClient';
// `loadIsomorphicCodeVariant` is the heavy load/parse/transform pipeline. It is
// imported statically here because this whole module is dynamically imported by
// `CodeHighlighterChunk` (`() => import('./CodeSourceLoader')`) only when the
// render decision routes to the server loader - so it already lives in this lazy
// chunk and never reaches the path that renders precomputed content.
import { loadIsomorphicCodeVariant } from '../pipeline/loadIsomorphicCodeVariant/loadIsomorphicCodeVariant';
import * as Errors from './errors';

/**
 * The chunk's full **server loader**: load every variant (highlighting them via the
 * heavy `loadIsomorphicCodeVariant` pipeline), then render the `'use client'`
 * `CodeHighlighterClient` with the loaded `Code`. Dynamically imported by
 * `CodeHighlighterChunk`, so it (and the pipeline) only reach the bundle when the
 * decision actually routes here. The prepared loading `fallback`/`residualFallbacks`
 * ride through the user props.
 */
export default async function CodeSourceLoader(
  props: CodeHighlighterChunkContentProps,
): Promise<React.ReactElement> {
  const { data, loading, ...userProps } = props;

  // Start with the loaded code from the chunk's data (precompute/wire code), or
  // load it via `loadCodeMeta` when nothing was provided.
  let loadedCode = data ?? userProps.code ?? userProps.precompute;
  if (!loadedCode) {
    if (!userProps.loadCodeMeta) {
      throw new Errors.ErrorCodeHighlighterServerMissingLoadCodeMeta();
    }

    if (!userProps.url) {
      throw new Errors.ErrorCodeHighlighterServerMissingUrlForLoadCodeMeta();
    }

    try {
      loadedCode = await userProps.loadCodeMeta(userProps.url);
    } catch (error) {
      throw new Errors.ErrorCodeHighlighterServerLoadCodeFailure(userProps.url, error);
    }
  }

  // TODO: if props.variant is provided, we should only load that variant

  // Process globalsCode: use already processed version if available, otherwise
  // convert string URLs to Code objects.
  let processedGlobalsCode: Array<Code> | undefined = userProps.processedGlobalsCode;
  if (!processedGlobalsCode && userProps.globalsCode && userProps.globalsCode.length > 0) {
    const hasStringUrls = userProps.globalsCode.some((item) => typeof item === 'string');
    if (hasStringUrls && !userProps.loadCodeMeta) {
      throw new Errors.ErrorCodeHighlighterServerMissingLoadCodeMetaForGlobals();
    }

    // Load all string URLs in parallel, keep Code objects as-is
    const globalsPromises = userProps.globalsCode.map(async (globalItem) => {
      if (typeof globalItem === 'string') {
        try {
          return await userProps.loadCodeMeta!(globalItem);
        } catch (error) {
          throw new Errors.ErrorCodeHighlighterServerLoadGlobalsFailure(globalItem, error);
        }
      }
      return globalItem;
    });

    processedGlobalsCode = await Promise.all(globalsPromises);
  }

  const variantNames = Object.keys(userProps.components || loadedCode || {});
  const variantCodes = await Promise.all(
    variantNames.map((variantName) => {
      const variantCode = loadedCode[variantName];
      const variantUrl =
        typeof variantCode === 'object' && variantCode?.url ? variantCode.url : userProps.url;

      // Convert processedGlobalsCode to VariantCode | string for this specific variant
      let resolvedGlobalsCode: Array<VariantCode | string> | undefined;
      if (processedGlobalsCode && processedGlobalsCode.length > 0) {
        resolvedGlobalsCode = [];
        for (const codeObj of processedGlobalsCode) {
          const targetVariant = codeObj[variantName];
          if (targetVariant) {
            resolvedGlobalsCode.push(targetVariant);
          }
        }
      }

      let output: 'hast' | 'hastJson' | 'hastCompressed' = 'hastCompressed';
      if (userProps.deferParsing === 'json') {
        output = 'hastJson';
      } else if (userProps.deferParsing === 'none') {
        output = 'hast';
      }

      return loadIsomorphicCodeVariant(variantUrl, variantName, variantCode, {
        sourceParser: userProps.sourceParser,
        loadSource: userProps.loadSource,
        loadVariantMeta: userProps.loadVariantMeta,
        sourceTransformers: userProps.sourceTransformers,
        sourceEnhancers: userProps.sourceEnhancers,
        globalsCode: resolvedGlobalsCode,
        output,
        urlPrefix: userProps.urlPrefix,
      })
        .then((variant) => ({ name: variantName, variant }))
        .catch((error) => ({ error }));
    }),
  );

  const processedCode: Code = {};
  const errors: Error[] = [];
  for (const item of variantCodes) {
    if ('error' in item) {
      console.error(
        new Errors.ErrorCodeHighlighterServerLoadVariantFailure(userProps.url!, item.error),
      );
      errors.push(item.error);
    } else {
      processedCode[item.name] = item.variant.code;
    }
  }

  if (errors.length > 0) {
    throw new Errors.ErrorCodeHighlighterServerLoadVariantsFailure(userProps.url!, errors);
  }

  const clientProps = createClientProps({
    ...userProps,
    code: processedCode,
    processedGlobalsCode,
  } as CreateClientPropsOptions<{}>);

  return <CodeHighlighterClient {...clientProps} />;
}
