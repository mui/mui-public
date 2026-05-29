import { compressHast, decompressHast } from '../pipeline/hastUtils';
import {
  collapsedVisibleFallback,
  fallbackToText,
  type CompressedFallback,
} from './fallbackFormat';
import type { Code, Fallbacks, VariantExtraFiles } from './types';

/**
 * The residual fallbacks a `ContentLoading` component never renders, grouped
 * `variant → fileName → FallbackNode[]`. They exist only as the DEFLATE
 * dictionary for decompressing `hastCompressed`, so they ride across the
 * boundary as a single compressed blob rather than inline plain text.
 */
export type ResidualFallbacks = Record<string, Fallbacks>;

/**
 * Residual blobs whose JSON is below this many bytes are left uncompressed —
 * the DEFLATE + base64 framing would only grow such a small payload.
 */
export const FALLBACK_COMPRESSION_MIN_BYTES = 128;

/**
 * Build the preset-dictionary text for the residual blob from the *rendered*
 * fallbacks (the subset `ContentLoading` paints, already on the client as plain
 * text). Priming the residual with this text lets DEFLATE backreference the
 * rendered file — most valuable for a near-duplicate sibling like a TypeScript
 * variant of a rendered JavaScript file.
 *
 * Deterministic across server and client: variants and files are visited in
 * sorted key order so both sides build byte-identical dictionaries (a mismatch
 * would otherwise fail the embedded checksum on decode).
 */
export function residualDictionaryText(rendered: ResidualFallbacks): string {
  let text = '';
  for (const variantName of Object.keys(rendered).sort()) {
    const files = rendered[variantName];
    for (const fileName of Object.keys(files).sort()) {
      text += fallbackToText(files[fileName]);
    }
  }
  return text;
}

/**
 * Compress the residual fallbacks into a single self-describing blob. A single
 * DEFLATE stream deduplicates text shared across the residual files and
 * variants — and against the rendered subset too when `dictionaryText` is
 * supplied (see `residualDictionaryText`).
 *
 * Returns `undefined` when there is nothing worth compressing (no residual, or
 * a residual below the byte threshold), signalling the caller to keep the plain
 * fallbacks inline.
 */
export function compressResidualFallbacks(
  residual: ResidualFallbacks,
  dictionaryText?: string,
): CompressedFallback | undefined {
  if (Object.keys(residual).length === 0) {
    return undefined;
  }
  const json = JSON.stringify(residual);
  if (json.length < FALLBACK_COMPRESSION_MIN_BYTES) {
    return undefined;
  }
  return { fallbackCompressed: compressHast(json, dictionaryText) };
}

/**
 * Reverse {@link compressResidualFallbacks}. `dictionaryText` must match what
 * was used to compress; the embedded checksum throws on a mismatch rather than
 * yielding a corrupt dictionary.
 */
export function decompressResidualFallbacks(
  blob: CompressedFallback,
  dictionaryText?: string,
): ResidualFallbacks {
  return JSON.parse(decompressHast(blob.fallbackCompressed, dictionaryText)) as ResidualFallbacks;
}

/**
 * Pull every `fallback` off a (post-strip) `Code` into a `ResidualFallbacks`
 * map, returning a `Code` with those fallbacks removed. After
 * `stripFallbackHastsFromCode` has hoisted the rendered subset, every fallback
 * still on `Code` is residual — so this needs no scope flags.
 *
 * Pure: the input is left untouched; only the variants that lose a fallback are
 * shallow-cloned.
 */
export function extractResidualFallbacks(code: Code): {
  wireCode: Code;
  residual: ResidualFallbacks;
} {
  const wireCode: Code = {};
  const residual: ResidualFallbacks = {};

  for (const [variantName, variant] of Object.entries(code)) {
    if (!variant || typeof variant === 'string') {
      wireCode[variantName] = variant;
      continue;
    }

    const files: Fallbacks = {};
    let nextVariant = variant;

    // Main file — only extractable when its fileName can key the map.
    if (variant.fallback && variant.fileName) {
      files[variant.fileName] = variant.fallback;
      const { fallback: omitted, ...rest } = variant;
      nextVariant = rest;
    }

    // Extra files.
    if (variant.extraFiles) {
      let nextExtraFiles: VariantExtraFiles | undefined;
      for (const [fileName, fileData] of Object.entries(variant.extraFiles)) {
        if (typeof fileData === 'string' || !fileData.fallback) {
          continue;
        }
        files[fileName] = fileData.fallback;
        if (!nextExtraFiles) {
          nextExtraFiles = { ...variant.extraFiles };
        }
        const { fallback: omitted, ...rest } = fileData;
        nextExtraFiles[fileName] = rest;
      }
      if (nextExtraFiles) {
        nextVariant = { ...nextVariant, extraFiles: nextExtraFiles };
      }
    }

    wireCode[variantName] = nextVariant;
    if (Object.keys(files).length > 0) {
      residual[variantName] = files;
    }
  }

  return { wireCode, residual };
}

/**
 * Scatter a decompressed `ResidualFallbacks` map back onto `Code`, restoring
 * each `fallback` to the variant or extra file it came from — the inverse of
 * {@link extractResidualFallbacks}. Reconstructs exactly the in-memory layout a
 * non-consolidated payload would have had, so downstream consumers are unaware
 * the residual ever travelled compressed.
 *
 * Pure: only the variants that regain a fallback are shallow-cloned.
 */
export function scatterResidualFallbacks(code: Code, residual: ResidualFallbacks): Code {
  const restored: Code = {};

  for (const [variantName, variant] of Object.entries(code)) {
    const files = residual[variantName];
    if (!variant || typeof variant === 'string' || !files) {
      restored[variantName] = variant;
      continue;
    }

    let nextVariant = variant;
    let nextExtraFiles: VariantExtraFiles | undefined;

    for (const [fileName, fallback] of Object.entries(files)) {
      if (fileName === variant.fileName) {
        nextVariant = { ...nextVariant, fallback };
      } else {
        const fileData = variant.extraFiles?.[fileName];
        if (fileData && typeof fileData === 'object') {
          if (!nextExtraFiles) {
            nextExtraFiles = { ...variant.extraFiles };
          }
          nextExtraFiles[fileName] = { ...fileData, fallback };
        }
      }
    }

    if (nextExtraFiles) {
      nextVariant = { ...nextVariant, extraFiles: nextExtraFiles };
    }
    restored[variantName] = nextVariant;
  }

  return restored;
}

/**
 * Reduce every fallback in a rendered-subset map to its collapsed window (see
 * `collapsedVisibleFallback`). Used by `fallbackCollapsed` to hand
 * `ContentLoading` only the on-screen lines while the full fallbacks ride along
 * in the residual blob.
 */
export function collapseRenderedFallbacks(rendered: ResidualFallbacks): ResidualFallbacks {
  const collapsed: ResidualFallbacks = {};
  for (const [variantName, files] of Object.entries(rendered)) {
    const collapsedFiles: Fallbacks = {};
    for (const [fileName, fallback] of Object.entries(files)) {
      collapsedFiles[fileName] = collapsedVisibleFallback(fallback);
    }
    collapsed[variantName] = collapsedFiles;
  }
  return collapsed;
}

/**
 * Deep-merge two residual maps (`variant → fileName → fallback`), with `b`
 * winning on conflicts. Used to fold the rendered files' full fallbacks into
 * the residual when `fallbackCollapsed` defers them.
 */
export function mergeResidualFallbacks(
  first: ResidualFallbacks,
  second: ResidualFallbacks,
): ResidualFallbacks {
  const merged: ResidualFallbacks = {};
  for (const [variantName, files] of Object.entries(first)) {
    merged[variantName] = { ...files };
  }
  for (const [variantName, files] of Object.entries(second)) {
    merged[variantName] = { ...merged[variantName], ...files };
  }
  return merged;
}
