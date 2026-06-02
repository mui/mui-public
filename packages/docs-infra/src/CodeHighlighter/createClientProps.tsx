import * as React from 'react';
import type {
  Code,
  CodeHighlighterBaseProps,
  CodeHighlighterClientProps,
  ContentProps,
} from './types';
import type { CompressedFallback } from './fallbackFormat';
import { replaceUrlPrefix } from '../pipeline/loaderUtils/applyUrlPrefix';

export interface CreateClientPropsOptions<T extends {}> extends CodeHighlighterBaseProps<T> {
  code?: Code;
  fallback?: React.ReactNode;
  skipFallback?: boolean;
  processedGlobalsCode?: Array<Code>;
  residualFallbacks?: CompressedFallback;
}

/**
 * Assemble the props for the `'use client'` `CodeHighlighterClient` from the
 * server/isomorphic props: rewrite the top-level URL to its hosted form, pre-render
 * the `Content` element (functions can't cross the server-client boundary), and
 * forward the loading `fallback` and compressed `residualFallbacks`.
 */
export function createClientProps<T extends {}>(
  props: CreateClientPropsOptions<T>,
): CodeHighlighterClientProps {
  const highlightAfter = props.highlightAfter === 'stream' ? 'init' : props.highlightAfter;
  const enhanceAfter = props.enhanceAfter === 'stream' ? 'init' : props.enhanceAfter;

  // Rewrite the top-level URL before it leaves the server. The client never
  // receives `urlPrefix` (and shouldn't deal with `file://` URLs), so any
  // local URL must be translated to its hosted form here. Variant-level URLs
  // inside `code`/`precompute` are already rewritten upstream (by
  // `loadIsomorphicCodeVariant` on the server, or by the demo factory for precomputed
  // input).
  const url =
    props.urlPrefix && props.url ? replaceUrlPrefix(props.url, props.urlPrefix) : props.url;

  const contentProps = {
    ...props.contentProps,
    code: props.code || props.precompute,
    components: props.components,
    name: props.name,
    slug: props.slug,
    url,
    variantType: props.variantType,
  } as ContentProps<T>;

  return {
    url,
    code: props.code,
    precompute: props.precompute,
    components: props.components,
    variants: props.variants,
    variant: props.variant,
    fileName: props.fileName,
    initialVariant: props.initialVariant,
    defaultVariant: props.defaultVariant,
    highlightAfter: highlightAfter || 'idle',
    enhanceAfter: enhanceAfter || 'idle',
    skipFallback: props.skipFallback,
    controlled: props.controlled,
    editActivation: props.editActivation,
    residualFallbacks: props.residualFallbacks,
    name: props.name,
    slug: props.slug,
    // Use processedGlobalsCode if available, otherwise fall back to raw globalsCode
    globalsCode: props.processedGlobalsCode || props.globalsCode,

    // Note: it is important that we render components before passing them to the client
    // otherwise we will get an error because functions can't be serialized
    // On the client, in order to send data to these components, we have to set context
    fallback: props.fallback,
    children: <props.Content {...contentProps} />,
  };
}
