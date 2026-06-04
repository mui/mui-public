import * as React from 'react';
import type {
  Code,
  CodeHighlighterBaseProps,
  ContentLoadingProps,
  SourceComments,
  VariantExtraFiles,
  VariantSource,
} from './types';
import type { CompressedFallback } from './fallbackFormat';
import { buildStringFallback } from './buildStringFallback';
import { codeToFallbackProps, stripFallbackHastsFromCode } from './codeToFallbackProps';
import {
  collapseRenderedFallbacks,
  compressResidualFallbacks,
  extractResidualFallbacks,
  mergeResidualFallbacks,
  residualDictionaryText,
} from './fallbackCompression';
import { replaceUrlPrefix } from '../pipeline/loaderUtils/applyUrlPrefix';
import { getVariantFileLineCounts, type SourceLineCounts } from '../useCode/sourceLineCounts';

export interface PrepareInitialSourceOptions<T extends {}> extends CodeHighlighterBaseProps<T> {
  code: Code;
  initialVariant: string;
  initialFilename: string | undefined;
  initialSource: VariantSource;
  initialExtraFiles?: VariantExtraFiles;
  ContentLoading: React.ComponentType<ContentLoadingProps<T>>;
}

export interface PreparedInitialSource {
  /** The pre-rendered loading fallback (`<ContentLoading />`). */
  fallback: React.ReactNode;
  /**
   * The variant/file fallbacks the loading UI won't render, consolidated into a
   * single DEFLATE blob. Absent when there is nothing worth compressing.
   */
  residualFallbacks?: CompressedFallback;
  /** The `Code` to send to the client (fallbacks stripped/wired out when compressed). */
  codeForClient: Code;
}

/**
 * Prepare the loading fallback and the wire `Code` from the initial source. Hoists
 * the rendered subset onto `ContentLoading` props, strips those fallback HASTs off
 * `Code`, and consolidates the rest into a compressed `residualFallbacks` blob the
 * client decodes against the rendered text. The render *decision* (client vs server
 * load, stream vs await) is the chunk's job; this is just the shared preparation
 * used by the content path and the server loaders.
 */
export function prepareInitialSource<T extends {}>(
  props: PrepareInitialSourceOptions<T>,
): PreparedInitialSource {
  const ContentLoading = props.ContentLoading;
  const {
    slug,
    name,
    initialVariant,
    code,
    initialFilename,
    fallbackUsesExtraFiles,
    fallbackUsesAllVariants,
    fallbackCollapsed,
  } = props;

  // When the block starts expanded, the loading UI needs the full content, so
  // the `fallbackCollapsed` window optimization (paint only the collapsed slice,
  // defer the rest) doesn't apply — treat it as off everywhere below.
  const effectiveFallbackCollapsed = fallbackCollapsed && !props.initialExpanded;

  // Strip fallbackHast entries from Code — they move to ContentLoading props
  // as source/extraSource instead of being serialized on Code.
  const { strippedCode, allFallbackHasts } = stripFallbackHastsFromCode(
    code,
    initialVariant,
    fallbackUsesExtraFiles,
    fallbackUsesAllVariants,
  );

  // Compute the line counts (and, for inline strings, the windowed frames) for EVERY
  // file/variant passed to the fallback — the main file, extra files
  // (`fallbackUsesExtraFiles`), and extra variants (`fallbackUsesAllVariants`) — so
  // each carries its own `{ totalLines, focusedLines, collapsible }` downstream. Counts come from:
  // (1) the loader-stored counts on the code, else (2) reading the *original* source
  // here (where `hastCompressed` dictionaries are still present — they're stripped
  // before `codeToFallbackProps` runs), else (3) windowing an inline plain string.
  // Windowing also runs `sourceEnhancers` over a cheap line-guttered HAST (no syntax
  // highlighting) and hoists the truncated frames into `allFallbackHasts`, matching
  // the live render instead of `sourceToFallback`'s naive single focus frame. The raw
  // string stays on `codeForClient`, so the client still highlights it after hydration.
  const allLineCounts: Record<string, Record<string, SourceLineCounts>> = {};
  const { sourceEnhancers } = props;
  const variantsInScope = fallbackUsesAllVariants ? Object.keys(code ?? {}) : [initialVariant];
  for (const variantName of variantsInScope) {
    const variant = code?.[variantName];
    if (!variant || typeof variant === 'string') {
      continue;
    }
    const files: Array<{
      fileName: string;
      source: VariantSource | undefined;
      comments?: SourceComments;
    }> = [];
    if (variant.fileName) {
      files.push({
        fileName: variant.fileName,
        source: variant.source,
        comments: variant.comments,
      });
    }
    if ((fallbackUsesExtraFiles || fallbackUsesAllVariants) && variant.extraFiles) {
      for (const [fileName, fileData] of Object.entries(variant.extraFiles)) {
        if (typeof fileData === 'object') {
          files.push({ fileName, source: fileData.source, comments: fileData.comments });
        }
      }
    }
    for (const file of files) {
      const storedFile =
        variant.fileName === file.fileName ? variant : variant.extraFiles?.[file.fileName];
      let counts: SourceLineCounts | undefined =
        storedFile && typeof storedFile !== 'string' && storedFile.totalLines !== undefined
          ? {
              totalLines: storedFile.totalLines,
              focusedLines: storedFile.focusedLines ?? storedFile.totalLines,
              collapsible: storedFile.collapsible === true,
            }
          : undefined;
      if (!counts) {
        // Read off the original source; a missing dictionary throws — non-fatal here.
        // `totalLines === 0` ⇒ a hast with no `root.data` counts (not a real count).
        try {
          const read = getVariantFileLineCounts(variant, file.fileName);
          counts = read && read.totalLines > 0 ? read : undefined;
        } catch {
          counts = undefined;
        }
      }
      // Window an inline plain-string source (needs enhancers, and not already framed
      // by the loader) and override the counts with the resulting window.
      if (
        sourceEnhancers &&
        sourceEnhancers.length > 0 &&
        typeof file.source === 'string' &&
        !allFallbackHasts[variantName]?.[file.fileName]
      ) {
        const windowed = buildStringFallback(
          file.source,
          file.comments,
          file.fileName,
          sourceEnhancers,
        );
        if (windowed) {
          (allFallbackHasts[variantName] ??= {})[file.fileName] = windowed.fallback;
          counts = {
            totalLines: windowed.totalLines,
            focusedLines: windowed.focusedLines,
            collapsible: windowed.collapsible,
          };
        }
      }
      if (counts) {
        (allLineCounts[variantName] ??= {})[file.fileName] = {
          totalLines: counts.totalLines,
          // Render-time collapse-to-empty empties every file's window (oversized
          // `'hide'` already records `focusedLines === 0`). `useCodeFallback` applies
          // the same rule when it demotes the source, so they stay consistent.
          focusedLines: props.collapseToEmpty ? 0 : counts.focusedLines,
          collapsible: props.collapseToEmpty ? true : counts.collapsible,
        };
      }
    }
  }

  // Rewrite the top-level URL before it reaches the loading fallback so the
  // browser never sees `file://` URLs. See `createClientProps` for the same
  // rewrite on the regular client path.
  const url =
    props.urlPrefix && props.url ? replaceUrlPrefix(props.url, props.urlPrefix) : props.url;

  // `fallbackCollapsed` paints only each file's collapsed window in the loading
  // UI; the full fallbacks defer into the blob. Otherwise the loading UI gets
  // the full rendered subset, as usual.
  //
  // A file produced with `oversizedFocus: 'hide'` records `focusedLines === 0`
  // (collapse-to-nothing): its collapsed window is empty, so we tell
  // `collapseRenderedFallbacks` to emit no frames for it rather than fall back
  // to the first frame — matching the hydrated render. The render-time
  // `collapseToEmpty` flag empties the window for every file the same way.
  const collapsesToEmpty = (variantName: string, fileName: string): boolean => {
    if (props.collapseToEmpty) {
      return true;
    }
    // A windowed inline-string file has authoritative counts here; precomputed
    // sources read theirs off `root.data` via `getVariantFileLineCounts`.
    const windowed = allLineCounts[variantName]?.[fileName];
    if (windowed) {
      return windowed.focusedLines === 0;
    }
    const variant = code[variantName];
    if (!variant || typeof variant === 'string') {
      return false;
    }
    return getVariantFileLineCounts(variant, fileName)?.focusedLines === 0;
  };
  const contentLoadingHasts = effectiveFallbackCollapsed
    ? collapseRenderedFallbacks(allFallbackHasts, collapsesToEmpty)
    : allFallbackHasts;

  // `allLineCounts` gives `codeToFallbackProps` a window for EVERY file/variant it
  // emits — main, extra files, and extra variants — so each carries its own
  // `totalLines`/`focusedLines`/`collapsible` (collapse-to-empty is applied per file in
  // `useCodeFallback`).
  const fallbackProps = codeToFallbackProps(
    initialVariant,
    strippedCode,
    initialFilename,
    fallbackUsesExtraFiles,
    fallbackUsesAllVariants,
    contentLoadingHasts,
    allLineCounts,
  );

  // Consolidate every fallback the loading UI won't render into a single DEFLATE
  // blob, primed with the rendered (collapsed, when `fallbackCollapsed`) text so
  // it dedupes against what's already on the client. That's everything still on
  // `strippedCode` after hoisting — plus, when `fallbackCollapsed`, each
  // rendered file's *full* fallback (the loading UI only painted its collapsed
  // window, so the rest must travel here). The blob crosses once; `wireCode`
  // carries no inline fallbacks, and the client decompresses + scatters them back
  // onto the code so its consumers (render and the swap line-count classifier)
  // read the dictionary off `code` regardless of which variant is active. When
  // there's nothing worth compressing, keep the plain inline fallbacks unchanged.
  const { wireCode, residual } = extractResidualFallbacks(strippedCode);
  const fullResidual = effectiveFallbackCollapsed
    ? mergeResidualFallbacks(residual, allFallbackHasts)
    : residual;
  const residualFallbacks = compressResidualFallbacks(
    fullResidual,
    residualDictionaryText(contentLoadingHasts),
  );
  const codeForClient = residualFallbacks ? wireCode : strippedCode;

  // Get the component for the selected variant
  const component = props.components?.[initialVariant];

  // Only include components (plural) if we're also including extraVariants
  const components = fallbackProps.extraVariants ? props.components : undefined;

  const contentProps = {
    ...props.contentProps,
    ...fallbackProps,
    name,
    slug,
    url,
    initialFilename,
    initialVariant,
    component,
    components,
    // Signals the ContentLoading that `source` is only the collapsed window,
    // so it can disable any expand control until the full content swaps in.
    // Off when the block starts expanded (the loading UI gets the full content).
    ...(effectiveFallbackCollapsed ? { fallbackCollapsed: true } : undefined),
    // Render-time collapse-to-empty: the loading placeholder paints an empty window
    // too (via `useCodeFallback`), matching the hydrated render.
    ...(props.collapseToEmpty ? { collapseToEmpty: props.collapseToEmpty } : undefined),
    // Render-time default-expanded: the loading placeholder can render expanded
    // so it doesn't flash collapsed before hydration.
    ...(props.initialExpanded ? { initialExpanded: props.initialExpanded } : undefined),
  } as ContentLoadingProps<T>;

  const fallback = <ContentLoading {...contentProps} />;

  return { fallback, residualFallbacks, codeForClient };
}
