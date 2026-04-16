'use client';

import * as React from 'react';
import type { Root as HastRoot } from 'hast';
import { decompressHast } from '../pipeline/hastUtils';
import type { SourceEnhancers, SourceComments, VariantSource } from '../CodeHighlighter/types';

/**
 * Type guard to check if a source value is a HAST root node.
 * Used to determine if the source can be enhanced.
 */
function isHastRoot(source: unknown): source is HastRoot {
  if (typeof source !== 'object' || source === null) {
    return false;
  }
  return 'type' in source && (source as HastRoot).type === 'root';
}

/**
 * Resolves a VariantSource to a HastRoot if possible.
 * Handles decompression of compressed HAST and parsing of JSON HAST.
 *
 * @param source - The source to resolve (can be HAST, hastJson, hastCompressed, or string)
 * @returns The resolved HastRoot or null if the source cannot be resolved
 */
function resolveHastRoot(source: VariantSource | undefined): HastRoot | null {
  if (!source) {
    return null;
  }

  if (typeof source === 'string') {
    return null; // String sources need parsing first
  }

  if ('hastJson' in source) {
    return JSON.parse(source.hastJson) as HastRoot;
  }

  if ('hastCompressed' in source) {
    return JSON.parse(decompressHast(source.hastCompressed)) as HastRoot;
  }

  if (isHastRoot(source)) {
    return source;
  }

  return null;
}

/**
 * Applies enhancers sequentially to a HAST root, starting from a given index.
 * Each enhancer receives the output of the previous enhancer in the chain.
 */
async function applyEnhancersFrom(
  source: HastRoot,
  comments: SourceComments | undefined,
  fileName: string,
  enhancers: SourceEnhancers,
  startIndex: number,
): Promise<HastRoot> {
  return enhancers
    .slice(startIndex)
    .reduce<
      Promise<HastRoot>
    >((prev, enhancer) => prev.then((current) => enhancer(current, comments, fileName)), Promise.resolve(source));
}

interface SyncEnhanceResult {
  /** The result after applying all sync enhancers (and resolving any leading async ones) */
  syncResult: HastRoot;
  /** Index of the first enhancer that returned a Promise, or enhancers.length if all were sync */
  asyncStartIndex: number;
  /** The promise returned by the first async enhancer, if any */
  firstAsyncPromise: Promise<HastRoot> | null;
}

/**
 * Runs enhancers in order until one returns a Promise.
 * Returns the sync-enhanced result up to that point, plus the pending promise
 * and its index so the caller can continue from there without re-running sync work.
 */
function applyEnhancersUntilAsync(
  source: HastRoot,
  comments: SourceComments | undefined,
  fileName: string,
  enhancers: SourceEnhancers,
): SyncEnhanceResult {
  let current: HastRoot = source;
  for (let i = 0; i < enhancers.length; i += 1) {
    const result = enhancers[i](current, comments, fileName);
    if (result instanceof Promise) {
      return {
        syncResult: current,
        asyncStartIndex: i,
        firstAsyncPromise: result,
      };
    }
    current = result;
  }
  return {
    syncResult: current,
    asyncStartIndex: enhancers.length,
    firstAsyncPromise: null,
  };
}

export interface UseSourceEnhancingProps {
  /** The source to enhance (from transformed files or variant) */
  source: VariantSource | null | undefined;
  /** The filename for this source */
  fileName: string | undefined;
  /** Comments extracted from the source (typically from the original variant) */
  comments: SourceComments | undefined;
  /** Array of enhancer functions to apply */
  sourceEnhancers?: SourceEnhancers;
}

export interface UseSourceEnhancingResult {
  /** The enhanced source */
  enhancedSource: VariantSource | null;
  /** Whether enhancement is currently in progress */
  isEnhancing: boolean;
}

/**
 * Hook that applies source enhancers to a single source file.
 *
 * Enhancers are functions that modify the HAST (Hypertext Abstract Syntax Tree)
 * representation of code. They receive the parsed HAST root, any comments extracted
 * from the source code, and the filename for context.
 *
 * Enhancement runs asynchronously when the source or enhancers change.
 * The original source is returned immediately while enhancement runs in the background,
 * preventing layout shift since enhanced code should be visually similar.
 *
 * @example
 * ```tsx
 * // Enhancer that adds line highlighting based on comments
 * const highlightEnhancer: SourceEnhancer = (root, comments, fileName) => {
 *   // Use comments like { 5: ['@highlight'] } to add highlighting
 *   return addHighlightToLines(root, comments);
 * };
 *
 * function MyCodeDisplay({ source, fileName }) {
 *   const enhancers = React.useMemo(() => [highlightEnhancer], []);
 *   const { enhancedSource, isEnhancing } = useSourceEnhancing({
 *     source,
 *     fileName,
 *     comments: undefined,
 *     sourceEnhancers: enhancers,
 *   });
 *   return <Pre>{enhancedSource}</Pre>;
 * }
 * ```
 *
 * @remarks
 * - Only HAST sources can be enhanced. String sources are returned unchanged.
 * - Enhancers must return stable references to avoid infinite re-renders.
 * - Use `React.useMemo` for the enhancers array to prevent unnecessary re-runs.
 */
interface AsyncWork {
  firstAsyncPromise: Promise<HastRoot>;
  asyncStartIndex: number;
}

interface EnhanceState {
  enhancedSource: VariantSource | null;
  asyncWork: AsyncWork | null;
}

/**
 * Computes the synchronous enhancement result and any pending async work.
 * Enhancers are run in order; sync ones apply immediately, and the first
 * async enhancer's promise is captured so it can be continued in an effect.
 */
function computeEnhanceState(
  source: VariantSource | null | undefined,
  comments: SourceComments | undefined,
  fileName: string | undefined,
  sourceEnhancers: SourceEnhancers | undefined,
): EnhanceState {
  if (!source || !sourceEnhancers || sourceEnhancers.length === 0) {
    return { enhancedSource: source ?? null, asyncWork: null };
  }
  const resolved = resolveHastRoot(source);
  if (!resolved) {
    return { enhancedSource: source ?? null, asyncWork: null };
  }
  const { syncResult, firstAsyncPromise, asyncStartIndex } = applyEnhancersUntilAsync(
    resolved,
    comments,
    fileName || 'unknown',
    sourceEnhancers,
  );
  return {
    enhancedSource: syncResult,
    asyncWork: firstAsyncPromise ? { firstAsyncPromise, asyncStartIndex } : null,
  };
}

export function useSourceEnhancing({
  source,
  fileName,
  comments,
  sourceEnhancers,
}: UseSourceEnhancingProps): UseSourceEnhancingResult {
  // Track previous values to detect changes
  const [prevSource, setPrevSource] = React.useState(source);
  const [prevEnhancers, setPrevEnhancers] = React.useState(sourceEnhancers);
  const [prevComments, setPrevComments] = React.useState(comments);
  const [prevFileName, setPrevFileName] = React.useState(fileName);

  const [state, setState] = React.useState<EnhanceState>(() =>
    computeEnhanceState(source, comments, fileName, sourceEnhancers),
  );

  const hasChanged =
    source !== prevSource ||
    sourceEnhancers !== prevEnhancers ||
    comments !== prevComments ||
    fileName !== prevFileName;

  // When inputs change, apply sync enhancers immediately during render
  if (hasChanged) {
    if (source !== prevSource) {
      setPrevSource(source);
    }
    if (sourceEnhancers !== prevEnhancers) {
      setPrevEnhancers(sourceEnhancers);
    }
    if (comments !== prevComments) {
      setPrevComments(comments);
    }
    if (fileName !== prevFileName) {
      setPrevFileName(fileName);
    }
    setState(computeEnhanceState(source, comments, fileName, sourceEnhancers));
  }

  // Continue from the first async enhancer without re-running sync ones
  React.useEffect(() => {
    if (!state.asyncWork || !sourceEnhancers) {
      return undefined;
    }

    const { firstAsyncPromise, asyncStartIndex } = state.asyncWork;
    const enhancers = sourceEnhancers;
    const name = fileName || 'unknown';
    let cancelled = false;

    async function continueEnhancing() {
      const asyncResult = await firstAsyncPromise;
      if (cancelled) {
        return;
      }
      const final = await applyEnhancersFrom(
        asyncResult,
        comments,
        name,
        enhancers,
        asyncStartIndex + 1,
      );
      if (!cancelled) {
        setState({ enhancedSource: final, asyncWork: null });
      }
    }

    continueEnhancing();

    return () => {
      cancelled = true;
    };
  }, [state.asyncWork, sourceEnhancers, fileName, comments]);

  return {
    enhancedSource: state.enhancedSource,
    isEnhancing: state.asyncWork !== null,
  };
}
