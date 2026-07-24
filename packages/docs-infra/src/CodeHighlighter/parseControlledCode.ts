import type { Code, ControlledCode, HastRoot, ParseSource, VariantSource } from './types';
import type { PreParsedCacheEntry } from './CodeHighlighterContext';
import { isGrammarRegistered } from '../pipeline/parseSource/grammarCache';
import { resolveGrammarScope } from '../pipeline/parseSource/grammarMaps';

/**
 * Cache key for a parsed file. Qualified by variant so two variants that share a
 * file name (e.g. both have `Demo.tsx`) get independent entries instead of
 * evicting each other. The `\u0000` separator cannot appear in a variant key or
 * file name, so the two parts can never run together ambiguously.
 */
export function preParsedCacheKey(variant: string, fileName: string): string {
  return `${variant}\u0000${fileName}`;
}

/**
 * Pure function to parse controlled code and convert it to regular Code format.
 * Handles the conversion from ControlledCode (string|null sources) to Code (HAST nodes).
 *
 * When `preParsedCache` is supplied, each file's source is first looked up in
 * the cache (keyed by variant + file name). If the cached entry's source string
 * matches byte-for-byte, the cached HAST is reused and `parseSource` is skipped.
 * A fresh parse is WRITTEN THROUGH to the cache, so on the next controlled-code
 * change (a keystroke updates one file) every unchanged file is reused instead
 * of re-parsed — only the edited file's source differs. A stale entry is evicted
 * and replaced; a parse failure keeps the raw string and is not cached.
 */
export function parseControlledCode(
  controlledCode: ControlledCode,
  parseSource: ParseSource,
  preParsedCache?: Map<string, PreParsedCacheEntry>,
): Code {
  /**
   * Resolves one file's string source to HAST, reusing a cached parse on an exact
   * source match and writing a fresh parse through to the cache. Returns the raw
   * string (uncached) if `parseSource` throws.
   */
  const resolveSource = (variant: string, fileName: string, source: string): HastRoot | string => {
    const key = preParsedCacheKey(variant, fileName);
    const grammarScope = resolveGrammarScope(fileName);
    // An existing parser missing this file's grammar returns valid-looking plain HAST.
    // Do not retain that temporary fallback across the grammar-readiness rerender.
    const cacheable = !grammarScope || isGrammarRegistered(grammarScope) !== false;
    const entry = preParsedCache?.get(key);
    if (entry && cacheable) {
      if (entry.source === source) {
        return entry.hast;
      }
      preParsedCache?.delete(key);
    }
    try {
      const hast = parseSource(source, fileName);
      if (cacheable) {
        preParsedCache?.set(key, { source, hast });
      }
      return hast;
    } catch {
      return source;
    }
  };

  const parsed: Code = {};

  for (const [variant, variantCode] of Object.entries(controlledCode)) {
    if (variantCode === null) {
      // Explicitly deleted - skip this variant
      continue;
    }

    if (variantCode && typeof variantCode === 'object') {
      let mainSource;

      // Convert null to empty string, then parse
      const sourceToProcess = variantCode.source === null ? '' : variantCode.source;

      if (typeof sourceToProcess === 'string' && variantCode.fileName) {
        mainSource = resolveSource(variant, variantCode.fileName, sourceToProcess);
      } else if (typeof sourceToProcess === 'string' && !variantCode.fileName) {
        // Return a basic HAST root node with the source text for unsupported file types
        // This indicates that the source has at least passed through the parsing pipeline
        const source: VariantSource = {
          type: 'root',
          children: [
            {
              type: 'text',
              value: sourceToProcess,
            },
          ],
        };
        mainSource = source;
      } else {
        // Handle undefined or other non-string values
        mainSource = sourceToProcess;
      }

      // Parse extraFiles if present
      let extraFiles;
      if (variantCode.extraFiles) {
        const parsedExtraFiles: any = {};

        for (const [fileName, fileData] of Object.entries(variantCode.extraFiles)) {
          // Convert null to empty string, then parse
          const fileSourceToProcess = fileData.source === null ? '' : fileData.source;

          if (typeof fileSourceToProcess === 'string') {
            parsedExtraFiles[fileName] = {
              ...fileData,
              source: resolveSource(variant, fileName, fileSourceToProcess),
            };
          } else {
            // Keep other values as-is
            parsedExtraFiles[fileName] = {
              ...fileData,
              source: fileSourceToProcess,
            };
          }
        }

        extraFiles = parsedExtraFiles;
      }

      parsed[variant] = {
        ...variantCode,
        source: mainSource,
        extraFiles,
      };
    }
  }

  return parsed;
}
