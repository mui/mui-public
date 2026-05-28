'use client';

import * as React from 'react';
import type { Root as HastRoot } from 'hast';
import { decodeHastSource } from '../pipeline/loadIsomorphicCodeVariant/decodeHastSource';
import type { SourceEnhancers, SourceComments, VariantSource } from '../CodeHighlighter/types';
import {
  recordEnhancerApplied,
  shouldSkipEnhancer,
} from '../pipeline/loadIsomorphicCodeVariant/runSourceEnhancers';

/**
 * Resolves a `VariantSource` to a HAST root that is safe to mutate.
 *
 * Uses the shared `decodeHastSource` cache to amortize decompression and
 * `JSON.parse` across other consumers (`Pre`, `useFileNavigation`,
 * `sourceLineCounts`), then `structuredClone`s the result because the
 * enhancer pipeline mutates `root.data` via `recordEnhancerApplied`.
 * Returns `null` for string or unrecognized sources.
 */
function resolveHastRoot(source: VariantSource | undefined): HastRoot | null {
  const cached = decodeHastSource(source);
  return cached ? (structuredClone(cached) as HastRoot) : null;
}

/**
 * Applies enhancers sequentially to a HAST root, starting from a given index.
 * Each enhancer receives the output of the previous enhancer in the chain.
 * Enhancers with a stable `enhancerName` are skipped if already recorded on
 * the HAST root, and recorded after they run.
 */
async function applyEnhancersFrom(
  source: HastRoot,
  comments: SourceComments | undefined,
  fileName: string,
  enhancers: SourceEnhancers,
  startIndex: number,
): Promise<HastRoot> {
  let current = source;
  for (let i = startIndex; i < enhancers.length; i += 1) {
    const enhancer = enhancers[i];
    if (shouldSkipEnhancer(current, enhancer)) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    current = await enhancer(current, comments, fileName);
    recordEnhancerApplied(current, enhancer);
  }
  return current;
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
 *
 * Enhancers with a stable `enhancerName` are skipped if already recorded on
 * the HAST root, and recorded after they run.
 */
function applyEnhancersUntilAsync(
  source: HastRoot,
  comments: SourceComments | undefined,
  fileName: string,
  enhancers: SourceEnhancers,
): SyncEnhanceResult {
  let current: HastRoot = source;
  for (let i = 0; i < enhancers.length; i += 1) {
    const enhancer = enhancers[i];
    if (shouldSkipEnhancer(current, enhancer)) {
      continue;
    }
    const result = enhancer(current, comments, fileName);
    if (result instanceof Promise) {
      return {
        syncResult: current,
        asyncStartIndex: i,
        firstAsyncPromise: result.then((resolved) => {
          recordEnhancerApplied(resolved, enhancer);
          return resolved;
        }),
      };
    }
    current = result;
    recordEnhancerApplied(current, enhancer);
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
