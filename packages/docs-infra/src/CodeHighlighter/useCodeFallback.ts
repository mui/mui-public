'use client';

import * as React from 'react';
import type { ContentLoadingVariant, Fallbacks, HastRoot } from './types';
import { fallbackToHast } from './fallbackFormat';
import { resolveCollapsedFrameType } from '../pipeline/parseSource/frameVisibility';
import { isFrameSpan } from '../pipeline/parseSource/isFrameSpan';
import { hastToJsx } from '../pipeline/hastUtils';
import { CodeHighlighterFallbackContext } from './CodeHighlighterFallbackContext';

/**
 * Render-time "collapse to empty" for the loading placeholder: demotes every
 * collapsed-visible frame type in a fallback `HastRoot` to its hidden variant
 * (matching `<Pre>`'s live rewrite) so the collapse CSS paints an empty window,
 * and records `focusedLines: 0`. Mutates the freshly-decoded root in place.
 */
export function applyCollapseToEmptyToFallbackHast(root: HastRoot): HastRoot {
  for (const child of root.children) {
    if (child.type !== 'element' || !isFrameSpan(child)) {
      continue;
    }
    const frameType =
      typeof child.properties.dataFrameType === 'string'
        ? child.properties.dataFrameType
        : undefined;
    const resolved = resolveCollapsedFrameType(frameType, true);
    if (resolved === frameType) {
      continue;
    }
    if (!resolved || resolved === 'normal') {
      delete child.properties.dataFrameType;
    } else {
      child.properties.dataFrameType = resolved;
    }
  }
  root.data = { ...root.data, focusedLines: 0 };
  return root;
}

/** A decoded extra-file fallback: the rendered `HastRoot` plus its line counts. */
export interface UseCodeFallbackFile {
  source: HastRoot;
  totalLines?: number;
  focusedLines?: number;
  collapsible?: boolean;
}

export interface UseCodeFallbackResult {
  source?: HastRoot;
  fileNames?: string[];
  extraSource?: Record<string, UseCodeFallbackFile>;
  extraVariants?: Record<string, UseCodeFallbackVariantResult>;
  /**
   * `true` when the surrounding `CodeHighlighter` uses `fallbackCollapsed`, so
   * `source` is only the collapsed window. A `ContentLoading` should disable any
   * expand control while this is set — the hidden lines arrive with the full
   * content, not the fallback.
   */
  collapsed?: boolean;
  /**
   * Line counts for the displayed file, threaded from the server (the compact
   * `source` has dropped `root.data`, where they live). A `ContentLoading` mirrors
   * them onto the fallback `<code>` as `data-total-lines` / `data-focused-lines` so
   * it matches the hydrated `<Pre>`. `focusedLines` is the visible-window size —
   * forced to 0 here when `collapseToEmpty` empties the painted window, so it stays
   * consistent with the demoted `source`. `collapsible` is threaded separately
   * from the enhancer/loader because counts alone cannot describe whether the
   * collapsed frame structure has hidden content to expand into.
   */
  totalLines?: number;
  focusedLines?: number;
  collapsible?: boolean;
  /**
   * Ready-to-render `<code>` for the displayed file — the rendered `source` with
   * `data-filename` / `data-collapsible` / `data-total-lines` / `data-focused-lines`
   * and the `language-{language}` class already applied, matching `<Pre>`. Drop it
   * into a `<pre>` so a `ContentLoading` needn't re-wire (or drift from) those
   * attributes. `null` when there's no source to paint.
   */
  code?: React.ReactNode;
}

export interface UseCodeFallbackVariantResult {
  fileNames?: string[];
  source?: HastRoot;
  totalLines?: number;
  focusedLines?: number;
  collapsible?: boolean;
  extraSource?: Record<string, UseCodeFallbackFile>;
}

interface UseCodeFallbackProps extends ContentLoadingVariant {
  initialVariant?: string;
  initialFilename?: string;
  extraVariants?: Record<string, ContentLoadingVariant>;
  fallbackCollapsed?: boolean;
  collapseToEmpty?: boolean | 'true';
  totalLines?: number;
  focusedLines?: number;
  collapsible?: boolean;
}

function convertVariantSource(
  variant: ContentLoadingVariant,
  collapseToEmpty = false,
): UseCodeFallbackVariantResult {
  const rewrite = (nodes: HastRoot) =>
    collapseToEmpty ? applyCollapseToEmptyToFallbackHast(nodes) : nodes;
  // Collapse-to-empty empties every painted window, so report `focusedLines: 0` to
  // match the demoted `source` (mirrors `<Pre>`'s `collapseToEmpty ? 0 : ...`).
  const focused = (value: number | undefined) => (collapseToEmpty ? 0 : value);

  let source: HastRoot | undefined;
  let extraSource: Record<string, UseCodeFallbackFile> | undefined;
  if (variant.source) {
    source = rewrite(fallbackToHast(variant.source));
  }
  if (variant.extraSource) {
    extraSource = {};
    for (const [fName, file] of Object.entries(variant.extraSource)) {
      extraSource[fName] = {
        source: rewrite(fallbackToHast(file.source)),
        totalLines: file.totalLines,
        focusedLines: focused(file.focusedLines),
        collapsible: collapseToEmpty ? true : file.collapsible,
      };
    }
  }
  return {
    fileNames: variant.fileNames,
    source,
    totalLines: variant.totalLines,
    focusedLines: focused(variant.focusedLines),
    collapsible: collapseToEmpty ? true : variant.collapsible,
    extraSource,
  };
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

    // Hoist main variant source/extraSource (compact format). `extraSource` entries
    // are `{ source, totalLines, focusedLines }` objects now, so hoist `.source`.
    if (source || extraSource) {
      const hasts: Fallbacks = {};
      if (source && mainFile) {
        hasts[mainFile] = source;
      }
      if (extraSource) {
        for (const [fName, file] of Object.entries(extraSource)) {
          hasts[fName] = file.source;
        }
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
            for (const [fName, file] of Object.entries(variant.extraSource)) {
              hasts[fName] = file.source;
            }
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

  // Render-time collapse-to-empty empties the painted window (the string `'true'`
  // arrives via the serialized `data-content-props` channel).
  const collapseToEmpty = props.collapseToEmpty === true || props.collapseToEmpty === 'true';

  // Resolve extraVariants: prefer props, fall back to context
  const allExtraVariants = propsExtraVariants || ctxExtraVariants;
  let resolvedExtraVariants: Record<string, UseCodeFallbackVariantResult> | undefined;

  if (allExtraVariants) {
    resolvedExtraVariants = {};
    for (const [name, variant] of Object.entries(allExtraVariants)) {
      resolvedExtraVariants[name] = convertVariantSource(variant, collapseToEmpty);
    }
  }

  const converted = convertVariantSource(props, collapseToEmpty);
  const { totalLines, focusedLines, collapsible } = converted;
  // Build the displayed file's `<code>` once, here, so every ContentLoading paints
  // identical attributes to `<Pre>` (created via `React.createElement` to keep this a
  // `.ts` logic hook). `null` when there's nothing to paint. Extra files/variants
  // carry their own `source` + counts on `extraSource` / `extraVariants` for the
  // consumer to render the same way.
  const code = converted.source
    ? React.createElement(
        'code',
        {
          className: props.language ? `language-${props.language}` : undefined,
          'data-filename': props.fileNames?.[0],
          'data-collapsible': collapsible ? '' : undefined,
          'data-total-lines': totalLines,
          'data-focused-lines': focusedLines,
        },
        hastToJsx(converted.source),
      )
    : null;

  return {
    ...converted,
    extraVariants: resolvedExtraVariants,
    collapsed: props.fallbackCollapsed,
    code,
  };
}
