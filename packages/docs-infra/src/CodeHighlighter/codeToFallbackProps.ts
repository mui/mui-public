import type {
  BaseContentLoadingProps,
  Code,
  ContentLoadingVariant,
  Fallbacks,
  VariantCode,
  VariantSource,
} from './types';
import { hastToFallback, type FallbackNode } from './fallbackFormat';
import { getLanguageFromExtension } from '../pipeline/loaderUtils/getLanguageFromExtension';

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
 * becomes a single text node so the fallback renders the raw code before
 * highlighting. `hastCompressed` payloads can't be decoded here (no DEFLATE
 * dictionary), so without a variant `fallback` they yield `undefined`.
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
    // A `FallbackNode` string is a text node — render the raw code as-is.
    return [source];
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
): {
  fileNames: string[];
  source?: FallbackNode[];
  extraSource?: Record<string, FallbackNode[]>;
  language?: string;
} {
  const fileNames = [variantCode.fileName, ...Object.keys(variantCode.extraFiles || {})].filter(
    (name): name is string => Boolean(name),
  );
  const mainFile = variantCode.fileName || fileNames[0];

  let source: FallbackNode[] | undefined;
  let extraSource: Record<string, FallbackNode[]> | undefined;

  if (variantHasts) {
    // Pre-extracted fallback data (server path).
    if (mainFile && variantHasts[mainFile]) {
      source = variantHasts[mainFile];
    }
    const extra: Record<string, FallbackNode[]> = {};
    for (const [fName, nodes] of Object.entries(variantHasts)) {
      if (fName !== mainFile) {
        extra[fName] = nodes;
      }
    }
    if (Object.keys(extra).length > 0) {
      extraSource = extra;
    }
  } else {
    // No pre-extracted fallback data (e.g. dev mode). Prefer the variant's own
    // `fallback`, falling back to deriving one from the source directly.
    source = sourceToFallback(variantCode.source, variantCode.fallback);
    const extra: Record<string, FallbackNode[]> = {};
    for (const [fName, fData] of Object.entries(variantCode.extraFiles || {})) {
      if (typeof fData === 'object' && fData.source) {
        const fb = sourceToFallback(fData.source, fData.fallback);
        if (fb) {
          extra[fName] = fb;
        }
      }
    }
    if (Object.keys(extra).length > 0) {
      extraSource = extra;
    }
  }

  const language = source ? (variantCode.language ?? getLanguageFromFileName(mainFile)) : undefined;

  return { fileNames, source, extraSource, language };
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
): BaseContentLoadingProps {
  const variantCode = code?.[variant];
  if (!variantCode || typeof variantCode === 'string') {
    return {};
  }

  const { fileNames, source, extraSource, language } = deriveVariantSources(
    variantCode,
    allFallbackHasts?.[variant],
  );

  if (needsAllVariants) {
    const extraVariants = Object.entries(code || {}).reduce(
      (acc, [name, vCode]) => {
        if (name !== variant && vCode && typeof vCode !== 'string') {
          const {
            fileNames: evFileNames,
            source: evSource,
            extraSource: evExtraSource,
            language: evLanguage,
          } = deriveVariantSources(vCode, allFallbackHasts?.[name]);

          acc[name] = {
            fileNames: evFileNames,
            ...(evSource ? { source: evSource } : undefined),
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
      ...(language ? { language } : undefined),
      ...(extraSource ? { extraSource } : undefined),
      extraVariants,
    };
  }

  return {
    fileNames,
    ...(source ? { source } : undefined),
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
