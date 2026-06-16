import type { CodeHighlighter } from './CodeHighlighter';
import * as React from 'react';
import type {
  ChunkContentProps as CoordinatedChunkContentProps,
  ChunkLoadingProps as CoordinatedChunkLoadingProps,
} from '../CoordinatedLazy/types';
import { createCoordinatedLazy } from '../CoordinatedLazy/createCoordinatedLazy';
import type { Code, ContentLoadingProps } from './types';
import type { CompressedFallback } from './fallbackFormat';
import { createClientProps, type CreateClientPropsOptions } from './createClientProps';
import { CodeHighlighterClient } from './CodeHighlighterClient';

/**
 * The user props the CodeHighlighter chunk threads to its content + loaders. It
 * carries the isomorphic CodeHighlighter props plus the values prepared up front:
 * the rendered loading `fallback`, the compressed `residualFallbacks`, and the
 * resolved `initialVariant`. The content generic is erased here (`{}`); the user's
 * real content props ride through `Content`/`contentProps` and are rebuilt by
 * `createClientProps`.
 */
export interface CodeHighlighterChunkUserProps extends CodeHighlighter.Props<{}> {
  ContentLoading?: React.ComponentType<ContentLoadingProps<{}>>;
  /** The resolved initial variant key. */
  initialVariant?: string;
  /** Pre-rendered loading fallback, when an initial paint was prepared up front. */
  fallback?: React.ReactNode;
  /** Compressed residual fallbacks prepared alongside `fallback`. */
  residualFallbacks?: CompressedFallback;
  /** Globals code already resolved from string URLs to `Code`, when available. */
  processedGlobalsCode?: Array<Code>;
  /** Skip rendering the loading fallback on the client swap. */
  skipFallback?: boolean;
}

/** Props the chunk content/loaders receive (user props + resolved `data`/`loading`). */
export type CodeHighlighterChunkContentProps = CoordinatedChunkContentProps<
  CodeHighlighterChunkUserProps,
  Code
>;

/**
 * Render the `'use client'` `CodeHighlighterClient` from the resolved chunk props.
 * `data` is the `Code` to send to the client; the prepared `fallback`/`residualFallbacks`
 * ride through the user props. `CodeHighlighterClient` owns its own fallback->content
 * swap (so the chunk is configured `contentManagesSwap`).
 */
function CodeHighlighterChunkContent(props: CodeHighlighterChunkContentProps): React.ReactElement {
  const { data, loading, ...userProps } = props;
  const clientProps = createClientProps({
    ...userProps,
    code: data ?? userProps.code,
  } as CreateClientPropsOptions<{}>);
  return <CodeHighlighterClient {...clientProps} />;
}

/**
 * The chunk's loading placeholder, used as the Suspense fallback while a server
 * loader streams. It renders the pre-prepared `<ContentLoading />` element threaded
 * through the user props (the actual loading UI is built up front by
 * `prepareInitialSource`).
 */
function CodeHighlighterChunkLoading(
  props: CoordinatedChunkLoadingProps<CodeHighlighterChunkUserProps, Code>,
): React.ReactElement {
  return <React.Fragment>{props.fallback ?? null}</React.Fragment>;
}

/**
 * The isomorphic chunk that drives `CodeHighlighter`. `CodeHighlighter` computes the
 * decision inputs (`controlled`/`isInitial`/`forceClient`/`awaitServerLoad`/
 * `skipInitialLoad`) and this routes via the generic chunk decision:
 *
 * - content / content-initial / attempt-initial-client -> render the client directly
 *   (it self-manages its swap).
 * - server-loader -> dynamically import `CodeSourceLoader` (load all variants).
 * - server-initial -> dynamically import `CodeInitialSourceLoader` (load the initial,
 *   then re-enter this chunk to load the full content).
 *
 * The `Loader`/`InitialLoader` are only imported when the decision routes to them, so
 * the heavy load/parse pipeline stays off the path that renders precomputed content.
 */
export const CodeHighlighterChunk = createCoordinatedLazy<
  CodeHighlighterChunkUserProps,
  Code,
  never
>({
  ChunkContent: CodeHighlighterChunkContent,
  ChunkLoading: CodeHighlighterChunkLoading,
  // `CodeHighlighter` computes the decision per-render (it depends on more than the
  // preloaded value) and passes `controlled`/`isInitial` as overrides, so the config
  // predicates always defer (returning `false` disables the default
  // "preloaded !== undefined" rule, which would otherwise force content mode because
  // CodeHighlighter always has a preloaded `Code`).
  isLoaded: () => false,
  isInitial: () => false,
  Loader: () => import('./CodeSourceLoader'),
  InitialLoader: () => import('./CodeInitialSourceLoader'),
  contentManagesSwap: true,
});
