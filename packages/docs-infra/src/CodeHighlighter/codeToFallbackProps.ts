import type {
  Code,
  ContentLoadingFile,
  ContentLoadingVariant,
  VariantCode,
  VariantSource,
} from './types';

import { type Fallbacks, hastToFallback, type FallbackNode } from './fallbackFormat';
import { getLanguageFromExtension } from '../pipeline/loaderUtils/getLanguageFromExtension';
import { getVariantFileLineCounts, type SourceLineCounts } from '../useCode/sourceLineCounts';

// Local mirror of the (internal) fallback base shape returned by this builder.
// Kept here rather than exported from `./types` so it stays out of the public
// type surface; `ContentLoadingProps` inlines the same shape.
type BaseContentLoadingProps = ContentLoadingVariant & {
  name?: string;
  slug?: string;
  url?: string;
  extraVariants?: Record<string, ContentLoadingVariant>;
};

/** Per-variant → per-file line metadata threaded for the fallback. */
export type LineCountsByVariant = Record<string, Record<string, SourceLineCounts>>;

/**
 * Resolve a `language-{language}` hint for a file from its extension, used to
 * scope the fallback `<code>` styling the same way the post-load tree is.
 * Returns `undefined` when the name has no extension or it isn't recognized.
 */
function getLanguageFromFileName(fileName: string | undefined): string | undefined {
  if (!fileName) {
    return undefined;
  }
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) {
    return undefined;
  }
  return getLanguageFromExtension(fileName.slice(dotIndex));
}

/**
 * Resolve the compact fallback for a file. Prefers the pre-extracted variant
 * `fallback` (always emitted by the loader as a root fallback) and only derives
 * one from the source for live/dev trees that never went through the loader.
 *
 * A plain-string source (an unparsed code block, e.g. `<CodeHighlighter>{code}`)
 * is wrapped in a single focus frame so the fallback always has the same frame
 * structure as the highlighted render — never a bare text node. `hastCompressed`
 * payloads can't be decoded here (no DEFLATE dictionary), so without a variant
 * `fallback` they yield `undefined`.
 */
function sourceToFallback(
  source: VariantSource | undefined,
  fallback?: FallbackNode[],
): FallbackNode[] | undefined {
  if (fallback) {
    return fallback;
  }
  if (!source) {
    return undefined;
  }
  if (typeof source === 'string') {
    // Wrap the raw code in a single focus frame so the fallback always carries a
    // frame, matching the highlighted render (`buildRootFallback` likewise emits
    // frames with text children) — never a bare text node. The whole source is
    // the visible window; collapse-to-empty demotes it like any other focus frame.
    return [['span', 'frame', { dataFrameType: 'focus' }, source]];
  }
  if ('type' in source && source.type === 'root') {
    return hastToFallback(source);
  }
  if ('hastJson' in source) {
    return hastToFallback(JSON.parse(source.hastJson));
  }
  // hastCompressed cannot be decoded here without the dictionary
  return undefined;
}

/**
 * Derive the compact `source`/`extraSource` fallbacks and the `language` hint
 * for a single variant. Prefers the pre-extracted per-file fallbacks in
 * `variantHasts` (server path) and otherwise derives them from the variant's
 * own `source`/`fallback` (dev path). `language` comes from the variant's
 * explicit `language` or the main file's extension and is only set when a
 * `source` is present, mirroring how consumers gate the `language-{language}`
 * class behind a rendered source.
 */
function deriveVariantSources(
  variantCode: VariantCode,
  variantHasts: Fallbacks | undefined,
  variantLineCounts?: Record<string, SourceLineCounts>,
): {
  fileNames: string[];
  source?: FallbackNode[];
  totalLines?: number;
  focusedLines?: number;
  collapsible?: boolean;
  extraSource?: Record<string, ContentLoadingFile>;
  language?: string;
} {
  const fileNames = [variantCode.fileName, ...Object.keys(variantCode.extraFiles || {})].filter(
    (name): name is string => Boolean(name),
  );
  const mainFile = variantCode.fileName || fileNames[0];

  // Per-file line counts: prefer render-time windowing (`variantLineCounts`), else
  // the counts the loader stored on the code (`VariantCode` / extra-file `totalLines`
  // / `focusedLines`). So every file/variant carries its window, not just the main one.
  const fileCounts = (fileName: string): SourceLineCounts | undefined => {
    const threaded = variantLineCounts?.[fileName];
    if (threaded) {
      return threaded;
    }
    const file =
      variantCode.fileName === fileName ? variantCode : variantCode.extraFiles?.[fileName];
    if (file && typeof file !== 'string' && file.totalLines !== undefined) {
      return {
        totalLines: file.totalLines,
        focusedLines: file.focusedLines ?? file.totalLines,
        collapsible: file.collapsible === true,
      };
    }
    // Last resort: count lines off the source (a plain string with no enhancers ⇒
    // `focusedLines === totalLines`, matching `<Pre>`'s `getSourceLineCounts`). Guarded
    // because a `hastCompressed` source can't be decoded without its dictionary (which
    // the server strips before this runs) — the server passes `variantLineCounts`
    // instead, so this branch only really fires client-side where the dictionary is on
    // the code.
    try {
      const counts = getVariantFileLineCounts(variantCode, fileName);
      // `totalLines === 0` means a hast with no `root.data` counts (not a real count).
      return counts && counts.totalLines > 0 ? counts : undefined;
    } catch {
      return undefined;
    }
  };

  let source: FallbackNode[] | undefined;
  let extraSource: Record<string, ContentLoadingFile> | undefined;

  if (variantHasts) {
    // Pre-extracted fallback data (server path).
    if (mainFile && variantHasts[mainFile]) {
      source = variantHasts[mainFile];
    }
    const extra: Record<string, ContentLoadingFile> = {};
    for (const [fName, nodes] of Object.entries(variantHasts)) {
      if (fName !== mainFile) {
        extra[fName] = { source: nodes, ...fileCounts(fName) };
      }
    }
    if (Object.keys(extra).length > 0) {
      extraSource = extra;
    }
  } else {
    // No pre-extracted fallback data (e.g. dev mode). Prefer the variant's own
    // `fallback`, falling back to deriving one from the source directly.
    source = sourceToFallback(variantCode.source, variantCode.fallback);
    const extra: Record<string, ContentLoadingFile> = {};
    for (const [fName, fData] of Object.entries(variantCode.extraFiles || {})) {
      if (typeof fData === 'object' && fData.source) {
        const fb = sourceToFallback(fData.source, fData.fallback);
        if (fb) {
          extra[fName] = { source: fb, ...fileCounts(fName) };
        }
      }
    }
    if (Object.keys(extra).length > 0) {
      extraSource = extra;
    }
  }

  const language = source ? (variantCode.language ?? getLanguageFromFileName(mainFile)) : undefined;
  const mainCounts = source && mainFile ? fileCounts(mainFile) : undefined;

  return {
    fileNames,
    source,
    totalLines: mainCounts?.totalLines,
    focusedLines: mainCounts?.focusedLines,
    collapsible: mainCounts?.collapsible,
    extraSource,
    language,
  };
}

export function codeToFallbackProps(
  variant: string,
  code?: Code,
  // `fallbackUsesExtraFiles` / the selected file name are threaded in by both
  // call sites for signature parity, but the per-file gating now happens
  // upstream in `stripFallbackHastsFromCode` (which only hoists the allowed
  // files into `allFallbackHasts`), so the derivation below reads them off the
  // already-gated `allFallbackHasts` rather than re-applying the flags here.
  _fileName?: string,
  _needsAllFiles = false,
  needsAllVariants = false,
  allFallbackHasts?: Record<string, Fallbacks>,
  allLineCounts?: LineCountsByVariant,
): BaseContentLoadingProps {
  const variantCode = code?.[variant];
  if (!variantCode || typeof variantCode === 'string') {
    return {};
  }

  const { fileNames, source, totalLines, focusedLines, collapsible, extraSource, language } =
    deriveVariantSources(variantCode, allFallbackHasts?.[variant], allLineCounts?.[variant]);

  if (needsAllVariants) {
    const extraVariants = Object.entries(code || {}).reduce(
      (acc, [name, vCode]) => {
        if (name !== variant && vCode && typeof vCode !== 'string') {
          const {
            fileNames: evFileNames,
            source: evSource,
            totalLines: evTotalLines,
            focusedLines: evFocusedLines,
            collapsible: evCollapsible,
            extraSource: evExtraSource,
            language: evLanguage,
          } = deriveVariantSources(vCode, allFallbackHasts?.[name], allLineCounts?.[name]);

          acc[name] = {
            fileNames: evFileNames,
            ...(evSource ? { source: evSource } : undefined),
            ...(evTotalLines !== undefined ? { totalLines: evTotalLines } : undefined),
            ...(evFocusedLines !== undefined ? { focusedLines: evFocusedLines } : undefined),
            ...(evCollapsible !== undefined ? { collapsible: evCollapsible } : undefined),
            ...(evLanguage ? { language: evLanguage } : undefined),
            ...(evExtraSource ? { extraSource: evExtraSource } : undefined),
          };
        }
        return acc;
      },
      {} as Record<string, ContentLoadingVariant>,
    );

    return {
      fileNames,
      ...(source ? { source } : undefined),
      ...(totalLines !== undefined ? { totalLines } : undefined),
      ...(focusedLines !== undefined ? { focusedLines } : undefined),
      ...(collapsible !== undefined ? { collapsible } : undefined),
      ...(language ? { language } : undefined),
      ...(extraSource ? { extraSource } : undefined),
      extraVariants,
    };
  }

  return {
    fileNames,
    ...(source ? { source } : undefined),
    ...(totalLines !== undefined ? { totalLines } : undefined),
    ...(focusedLines !== undefined ? { focusedLines } : undefined),
    ...(collapsible !== undefined ? { collapsible } : undefined),
    ...(language ? { language } : undefined),
    ...(extraSource ? { extraSource } : undefined),
  };
}

/**
 * Read a variant's per-file fallbacks straight off its `VariantCode` `fallback`
 * fields (main + extra files), returning a `Fallbacks` map keyed by file name.
 *
 * The fallback crosses the server→client boundary exactly once: either on the
 * `VariantCode` (no `ContentLoading`) or — after `stripFallbackHastsFromCode`
 * moves it — on the `ContentLoading` props. This reads the former location, so
 * the client can resolve the DEFLATE dictionary for `hastCompressed` without a
 * hoist when there's no `ContentLoading`. Returns `undefined` when the variant
 * carries no fallback (a string variant, a live-HAST source, or one whose
 * fallbacks were stripped for a `ContentLoading` component) — in which case the
 * hoisted copy is used instead.
 */
export function deriveFallbacksFromCode(
  code: Code | undefined,
  variantName: string,
): Fallbacks | undefined {
  const variant = code?.[variantName];
  if (!variant || typeof variant === 'string') {
    return undefined;
  }

  const fallbacks: Fallbacks = {};
  if (variant.fallback && variant.fileName) {
    fallbacks[variant.fileName] = variant.fallback;
  }
  if (variant.extraFiles) {
    for (const [fileName, fileData] of Object.entries(variant.extraFiles)) {
      if (typeof fileData === 'object' && fileData.fallback) {
        fallbacks[fileName] = fileData.fallback;
      }
    }
  }

  return Object.keys(fallbacks).length > 0 ? fallbacks : undefined;
}

/**
 * Strip `fallback` entries from a `Code` object and return the
 * stripped Code alongside the extracted fallbacks grouped by variant → fileName.
 *
 * Used on the server to separate the fallback data from the Code
 * so Code is sent to CodeHighlighterClient without fallbacks, and
 * the data is passed to ContentLoading as source/extraSource props.
 */
export function stripFallbackHastsFromCode(
  code: Code | undefined,
  variantName: string,
  fallbackUsesExtraFiles?: boolean,
  fallbackUsesAllVariants?: boolean,
): { strippedCode: Code; allFallbackHasts: Record<string, Fallbacks> } {
  if (!code) {
    return { strippedCode: {}, allFallbackHasts: {} };
  }

  const allFallbackHasts: Record<string, Fallbacks> = {};
  const strippedCode: Code = {};
  const variantsToProcess = fallbackUsesAllVariants ? Object.keys(code) : [variantName];
  const variantsToProcessSet = new Set(variantsToProcess);

  for (const [key, variant] of Object.entries(code)) {
    if (!variant || typeof variant === 'string' || !variantsToProcessSet.has(key)) {
      strippedCode[key] = variant;
      continue;
    }

    const hasts: Fallbacks = {};
    let changed = false;

    // Main file
    if (variant.fallback && variant.fileName) {
      hasts[variant.fileName] = variant.fallback;
      changed = true;
    }

    // Extra files
    let strippedExtraFiles = variant.extraFiles;
    if ((fallbackUsesExtraFiles || fallbackUsesAllVariants) && variant.extraFiles) {
      const newExtraFiles = { ...variant.extraFiles };
      for (const [fName, fData] of Object.entries(variant.extraFiles)) {
        if (typeof fData !== 'string' && fData.fallback) {
          hasts[fName] = fData.fallback;
          const { fallback: omittedFallback, ...rest } = fData;
          newExtraFiles[fName] = rest;
          changed = true;
        }
      }
      if (changed) {
        strippedExtraFiles = newExtraFiles;
      }
    }

    if (changed) {
      const { fallback: omittedFallback, ...restVariant } = variant;
      strippedCode[key] = { ...restVariant, extraFiles: strippedExtraFiles };
    } else {
      strippedCode[key] = variant;
    }

    if (Object.keys(hasts).length > 0) {
      allFallbackHasts[key] = hasts;
    }
  }

  return { strippedCode, allFallbackHasts };
}
