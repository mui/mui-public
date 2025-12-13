'use client';

import * as React from 'react';
import type { Root as HastRoot } from 'hast';
import { decompressSync, strFromU8 } from 'fflate';
import { decode } from 'uint8-to-base64';
import type {
  SourceEnhancers,
  SourceComments,
  VariantSource,
  HastRoot as TypedHastRoot,
} from '../CodeHighlighter/types';

/**
 * Type guard to check if a source value is a HAST root node.
 * Used to determine if the source can be enhanced.
 */
function isHastRoot(source: unknown): source is HastRoot {
  return (
    typeof source === 'object' &&
    source !== null &&
    'type' in source &&
    (source as HastRoot).type === 'root'
  );
}

/**
 * Resolves a VariantSource to a HastRoot if possible.
 * Handles decompression of gzipped HAST and parsing of JSON HAST.
 *
 * @param source - The source to resolve (can be HAST, hastJson, hastGzip, or string)
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

  if ('hastGzip' in source) {
    return JSON.parse(strFromU8(decompressSync(decode(source.hastGzip)))) as HastRoot;
  }

  if (isHastRoot(source)) {
    return source;
  }

  return null;
}

/**
 * Applies enhancers sequentially to a HAST root.
 * Each enhancer receives the output of the previous enhancer in the chain.
 *
 * @param source - The initial HAST root to enhance
 * @param comments - Comments extracted from the source code (keyed by line number)
 * @param fileName - The name of the file being enhanced (used for context)
 * @param enhancers - Array of enhancer functions to apply in order
 * @returns The enhanced HAST root after all enhancers have been applied
 */
async function applyEnhancers(
  source: HastRoot,
  comments: SourceComments | undefined,
  fileName: string,
  enhancers: SourceEnhancers,
): Promise<HastRoot> {
  return enhancers.reduce(
    async (accPromise, enhancer) => {
      const acc = await accPromise;
      return enhancer(acc, comments, fileName);
    },
    Promise.resolve(source as TypedHastRoot),
  );
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
export function useSourceEnhancing({
  source,
  fileName,
  comments,
  sourceEnhancers,
}: UseSourceEnhancingProps): UseSourceEnhancingResult {
  // Track previous values to detect changes
  const [prevSource, setPrevSource] = React.useState(source);
  const [prevEnhancers, setPrevEnhancers] = React.useState(sourceEnhancers);

  // Start with the original source - show it immediately while enhancing
  const [enhancedSource, setEnhancedSource] = React.useState<VariantSource | null>(source ?? null);
  const [isEnhancing, setIsEnhancing] = React.useState(
    () => !!sourceEnhancers && sourceEnhancers.length > 0 && !!source,
  );

  // When source changes, immediately show the new unenhanced source
  // This prevents layout shift while enhancement runs in background
  if (source !== prevSource) {
    setPrevSource(source);
    setEnhancedSource(source ?? null);
    if (sourceEnhancers && sourceEnhancers.length > 0 && source) {
      setIsEnhancing(true);
    }
  }

  // Track if enhancers changed
  if (sourceEnhancers !== prevEnhancers) {
    setPrevEnhancers(sourceEnhancers);
    if (sourceEnhancers && sourceEnhancers.length > 0 && source) {
      setIsEnhancing(true);
    }
  }

  React.useEffect(() => {
    // If no source or no enhancers, just use original
    if (!source || !sourceEnhancers || sourceEnhancers.length === 0) {
      setEnhancedSource(source ?? null);
      setIsEnhancing(false);
      return undefined;
    }

    const resolvedHastRoot = resolveHastRoot(source);
    if (!resolvedHastRoot) {
      // Can't enhance non-HAST sources
      setEnhancedSource(source);
      setIsEnhancing(false);
      return undefined;
    }

    // Capture values for async function
    const enhancers = sourceEnhancers;
    const name = fileName || 'unknown';
    const hastRoot = resolvedHastRoot;
    let cancelled = false;

    async function enhance() {
      setIsEnhancing(true);

      const enhanced = await applyEnhancers(hastRoot, comments, name, enhancers);

      if (!cancelled) {
        setEnhancedSource(enhanced);
        setIsEnhancing(false);
      }
    }

    enhance();

    return () => {
      cancelled = true;
    };
  }, [source, fileName, comments, sourceEnhancers]);

  return {
    enhancedSource,
    isEnhancing,
  };
}
