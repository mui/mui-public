import type { Code, ControlledCode, HastRoot, ParseSource, VariantSource } from './types';
import type { PreParsedCacheEntry } from './CodeHighlighterContext';

/**
 * Pure function to parse controlled code and convert it to regular Code format.
 * Handles the conversion from ControlledCode (string|null sources) to Code (HAST nodes).
 *
 * When `preParsedCache` is supplied, each file's source is first looked up in
 * the cache. If the cached entry's source string matches byte-for-byte, the
 * cached HAST is reused and `parseSource` is skipped for that file. On a
 * mismatch the stale entry is evicted before re-parsing so the cache cannot
 * grow stale across rapid edits.
 */
export function parseControlledCode(
  controlledCode: ControlledCode,
  parseSource: ParseSource,
  preParsedCache?: Map<string, PreParsedCacheEntry>,
): Code {
  /**
   * Try the cache for `fileName`/`source`. Returns the cached HAST on an
   * exact match; evicts and returns `undefined` on a mismatch.
   */
  const tryCache = (fileName: string, source: string): HastRoot | undefined => {
    if (!preParsedCache) {
      return undefined;
    }
    const entry = preParsedCache.get(fileName);
    if (!entry) {
      return undefined;
    }
    if (entry.source === source) {
      return entry.hast;
    }
    preParsedCache.delete(fileName);
    return undefined;
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
        const cached = tryCache(variantCode.fileName, sourceToProcess);
        if (cached) {
          mainSource = cached;
        } else {
          try {
            mainSource = parseSource(sourceToProcess, variantCode.fileName);
          } catch (error) {
            // Keep original string if parsing fails
            mainSource = sourceToProcess;
          }
        }
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
            const cached = tryCache(fileName, fileSourceToProcess);
            if (cached) {
              parsedExtraFiles[fileName] = { source: cached, comments: fileData.comments };
            } else {
              try {
                const parsedSource = parseSource(fileSourceToProcess, fileName);
                parsedExtraFiles[fileName] = { source: parsedSource, comments: fileData.comments };
              } catch (error) {
                // Keep original if parsing fails
                parsedExtraFiles[fileName] = {
                  source: fileSourceToProcess,
                  comments: fileData.comments,
                };
              }
            }
          } else {
            // Keep other values as-is
            parsedExtraFiles[fileName] = {
              source: fileSourceToProcess,
              comments: fileData.comments,
            };
          }
        }

        extraFiles = parsedExtraFiles;
      }

      parsed[variant] = {
        fileName: variantCode.fileName,
        url: variantCode.url,
        source: mainSource,
        extraFiles,
        filesOrder: variantCode.filesOrder,
        comments: variantCode.comments,
      };
    }
  }

  return parsed;
}
