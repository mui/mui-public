'use client';

import * as React from 'react';
import type { ContentLoadingVariant, Fallbacks, HastRoot } from './types';
import { fallbackToHast } from './fallbackFormat';
import { CodeHighlighterFallbackContext } from './CodeHighlighterFallbackContext';

export interface UseCodeFallbackResult {
  source?: HastRoot;
  fileNames?: string[];
  extraSource?: Record<string, HastRoot>;
  extraVariants?: Record<string, UseCodeFallbackVariantResult>;
}

export interface UseCodeFallbackVariantResult {
  fileNames?: string[];
  source?: HastRoot;
  extraSource?: Record<string, HastRoot>;
}

interface UseCodeFallbackProps extends ContentLoadingVariant {
  initialVariant?: string;
  initialFilename?: string;
  extraVariants?: Record<string, ContentLoadingVariant>;
}

function convertVariantSource(variant: ContentLoadingVariant): UseCodeFallbackVariantResult {
  let source: HastRoot | undefined;
  let extraSource: Record<string, HastRoot> | undefined;
  if (variant.source) {
    source = fallbackToHast(variant.source);
  }
  if (variant.extraSource) {
    extraSource = {};
    for (const [fName, nodes] of Object.entries(variant.extraSource)) {
      extraSource[fName] = fallbackToHast(nodes);
    }
  }
  return { fileNames: variant.fileNames, source, extraSource };
}

/**
 * Hook for `ContentLoading` components to hoist fallback data
 * to `CodeHighlighterClient` for text-dictionary derivation.
 *
 * On the server-rendered path, Code is stripped of `fallback` entries
 * and the data arrives on ContentLoading as `source`/`extraSource` props
 * in compact `FallbackNode[]` format. This hook converts them back to
 * `HastRoot` for rendering and hoists the compact form for dictionaries.
 *
 * On the client-loaded path, `useInitialData` already hoists directly,
 * so this hook simply passes props through.
 *
 * @example
 * ```tsx
 * function MyContentLoading(props: ContentLoadingProps<{}>) {
 *   const { source, extraSource } = useCodeFallback(props);
 *   return (
 *     <div>
 *       {source && hastToJsx(source)}
 *     </div>
 *   );
 * }
 * ```
 */
export function useCodeFallback(props?: UseCodeFallbackProps): UseCodeFallbackResult {
  const ctx = React.useContext(CodeHighlighterFallbackContext);
  const { setFallbackHasts, onHookCalled } = ctx || {};
  const variantName = props?.initialVariant;
  const mainFile = props?.initialFilename || props?.fileNames?.[0];
  const source = props?.source;
  const extraSource = props?.extraSource;
  const propsExtraVariants = props?.extraVariants;
  const ctxExtraVariants = ctx?.extraVariants;

  // Signal to parent that useCodeFallback was called with props.
  // Only fires when props are provided — calling without props is the
  // exact misuse we want to detect. Child effects fire before parent
  // effects, so the flag is set before the parent's validation runs.
  const hasProps = !!props;
  React.useEffect(() => {
    if (hasProps) {
      onHookCalled?.();
    }
  }, [hasProps, onHookCalled]);

  // Hoist fallback data to CodeHighlighterClient via effect (not during render).
  // Deps use individual fields to avoid re-running when the props object identity changes.
  React.useEffect(() => {
    if (!setFallbackHasts || !variantName) {
      return;
    }

    // Hoist main variant source/extraSource (compact format)
    if (source || extraSource) {
      const hasts: Fallbacks = {};
      if (source && mainFile) {
        hasts[mainFile] = source;
      }
      if (extraSource) {
        Object.assign(hasts, extraSource);
      }
      if (Object.keys(hasts).length > 0) {
        setFallbackHasts(variantName, hasts);
      }
    }

    // Hoist extra variant fallbacks
    const allExtraVariants = propsExtraVariants || ctxExtraVariants;
    if (allExtraVariants) {
      for (const [name, variant] of Object.entries(allExtraVariants)) {
        if (variant.source) {
          const hasts: Fallbacks = {};
          const evMainFile = variant.fileNames?.[0];
          if (evMainFile && variant.source) {
            hasts[evMainFile] = variant.source;
          }
          if (variant.extraSource) {
            Object.assign(hasts, variant.extraSource);
          }
          if (Object.keys(hasts).length > 0) {
            setFallbackHasts(name, hasts);
          }
        }
      }
    }
  }, [
    setFallbackHasts,
    variantName,
    mainFile,
    source,
    extraSource,
    propsExtraVariants,
    ctxExtraVariants,
  ]);

  if (!props) {
    return {};
  }

  // Resolve extraVariants: prefer props, fall back to context
  const allExtraVariants = propsExtraVariants || ctxExtraVariants;
  let resolvedExtraVariants: Record<string, UseCodeFallbackVariantResult> | undefined;

  if (allExtraVariants) {
    resolvedExtraVariants = {};
    for (const [name, variant] of Object.entries(allExtraVariants)) {
      resolvedExtraVariants[name] = convertVariantSource(variant);
    }
  }

  return {
    ...convertVariantSource(props),
    extraVariants: resolvedExtraVariants,
  };
}
