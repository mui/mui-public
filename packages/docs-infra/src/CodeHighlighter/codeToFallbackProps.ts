import type {
  BaseContentLoadingProps,
  Code,
  ContentLoadingVariant,
  Fallbacks,
  VariantSource,
} from './types';
import { hastToFallback, type FallbackNode } from './fallbackFormat';

/**
 * Resolve the compact fallback for a file. Prefers the pre-extracted variant
 * `fallback` (always emitted by the loader as a root fallback) and only derives
 * one from the source for live/dev trees that never went through the loader.
 *
 * `hastCompressed` payloads can't be decoded here (no DEFLATE dictionary), so
 * without a variant `fallback` they yield `undefined`.
 */
function sourceToFallback(
  source: VariantSource | undefined,
  fallback?: FallbackNode[],
): FallbackNode[] | undefined {
  if (fallback) {
    return fallback;
  }
  if (!source || typeof source === 'string') {
    return undefined;
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

export function codeToFallbackProps(
  variant: string,
  code?: Code,
  _fileName?: string,
  _needsAllFiles = false,
  needsAllVariants = false,
  allFallbackHasts?: Record<string, Fallbacks>,
): BaseContentLoadingProps {
  const variantCode = code?.[variant];
  if (!variantCode || typeof variantCode === 'string') {
    return {};
  }

  const fileNames = [variantCode.fileName, ...Object.keys(variantCode.extraFiles || {})].filter(
    (name): name is string => Boolean(name),
  );

  // Derive source/extraSource from extracted fallbacks when provided
  let source: FallbackNode[] | undefined;
  let extraSource: Record<string, FallbackNode[]> | undefined;

  const variantHasts = allFallbackHasts?.[variant];
  if (variantHasts) {
    const mainFile = variantCode.fileName || fileNames[0];
    if (mainFile && variantHasts[mainFile]) {
      source = variantHasts[mainFile];
    }
    const extra: Record<string, FallbackNode[]> = {};
    for (const [fName, h] of Object.entries(variantHasts)) {
      if (fName !== mainFile) {
        extra[fName] = h;
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

  if (needsAllVariants) {
    const extraVariants = Object.entries(code || {}).reduce(
      (acc, [name, vCode]) => {
        if (name !== variant && vCode && typeof vCode !== 'string') {
          const evFileNames = [vCode.fileName, ...Object.keys(vCode.extraFiles || {})].filter(
            (fn): fn is string => Boolean(fn),
          );
          const evHasts = allFallbackHasts?.[name];
          let evSource: FallbackNode[] | undefined;
          let evExtraSource: Record<string, FallbackNode[]> | undefined;

          if (evHasts) {
            const evMainFile = vCode.fileName || evFileNames[0];
            if (evMainFile && evHasts[evMainFile]) {
              evSource = evHasts[evMainFile];
            }
            const evExtra: Record<string, FallbackNode[]> = {};
            for (const [fName, h] of Object.entries(evHasts)) {
              if (fName !== evMainFile) {
                evExtra[fName] = h;
              }
            }
            if (Object.keys(evExtra).length > 0) {
              evExtraSource = evExtra;
            }
          } else {
            evSource = sourceToFallback(vCode.source, vCode.fallback);
            const evExtra: Record<string, FallbackNode[]> = {};
            for (const [fName, fData] of Object.entries(vCode.extraFiles || {})) {
              if (typeof fData === 'object' && fData.source) {
                const fb = sourceToFallback(fData.source, fData.fallback);
                if (fb) {
                  evExtra[fName] = fb;
                }
              }
            }
            if (Object.keys(evExtra).length > 0) {
              evExtraSource = evExtra;
            }
          }

          acc[name] = {
            fileNames: evFileNames,
            ...(evSource ? { source: evSource } : undefined),
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
      ...(extraSource ? { extraSource } : undefined),
      extraVariants,
    };
  }

  return {
    fileNames,
    ...(source ? { source } : undefined),
    ...(extraSource ? { extraSource } : undefined),
  };
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
