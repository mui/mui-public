import type { Nodes as HastNodes } from 'hast';
import type { Code, ParseSource } from './types';

/**
 * Pure function to parse code variants and their extraFiles.
 * Converts string sources to HAST nodes and handles hastJson parsing.
 */
export function parseCode(code: Code, parseSource: ParseSource): Code {
  const parsed: Code = {};

  for (const [variant, variantCode] of Object.entries(code)) {
    if (typeof variantCode === 'string') {
      // Already parsed/highlighted
      parsed[variant] = variantCode;
    } else if (variantCode && typeof variantCode === 'object') {
      // Parse if source is available and not already parsed
      if (variantCode.source && typeof variantCode.source === 'string') {
        try {
          const hastNodes = parseSource(variantCode.source, variantCode.fileName);

          // Also parse extraFiles if they contain sources that need parsing
          const parsedExtraFiles = variantCode.extraFiles
            ? Object.fromEntries(
                Object.entries(variantCode.extraFiles).map(([fileName, fileContent]) => {
                  if (typeof fileContent === 'string') {
                    return [fileName, fileContent]; // Keep string as-is
                  }
                  if (fileContent && typeof fileContent === 'object' && fileContent.source) {
                    if (typeof fileContent.source === 'string') {
                      // Parse string source in extraFile
                      try {
                        const parsedHastNodes = parseSource(fileContent.source, fileName);
                        return [fileName, { ...fileContent, source: parsedHastNodes }];
                      } catch (error) {
                        return [fileName, fileContent]; // Keep original if parsing fails
                      }
                    }
                  }
                  return [fileName, fileContent]; // Keep as-is for other cases
                }),
              )
            : undefined;

          parsed[variant] = {
            ...variantCode,
            source: hastNodes,
            extraFiles: parsedExtraFiles,
          };
        } catch (error) {
          // Keep original if parsing fails
          parsed[variant] = variantCode;
        }
      } else if (
        variantCode.source &&
        typeof variantCode.source === 'object' &&
        'hastJson' in variantCode.source
      ) {
        try {
          // Parse hastJson to HAST nodes
          const hastNodes: HastNodes = JSON.parse(variantCode.source.hastJson);

          // Also parse extraFiles if they contain sources that need parsing
          const parsedExtraFiles = variantCode.extraFiles
            ? Object.fromEntries(
                Object.entries(variantCode.extraFiles).map(([fileName, fileContent]) => {
                  if (typeof fileContent === 'string') {
                    return [fileName, fileContent]; // Keep string as-is
                  }
                  if (fileContent && typeof fileContent === 'object' && fileContent.source) {
                    if (typeof fileContent.source === 'string') {
                      // Parse string source in extraFile
                      try {
                        const parsedHastNodes = parseSource(fileContent.source, fileName);
                        return [fileName, { ...fileContent, source: parsedHastNodes }];
                      } catch (error) {
                        return [fileName, fileContent]; // Keep original if parsing fails
                      }
                    }
                  }
                  return [fileName, fileContent]; // Keep as-is for other cases
                }),
              )
            : undefined;

          parsed[variant] = {
            ...variantCode,
            source: hastNodes,
            extraFiles: parsedExtraFiles,
          };
        } catch (error) {
          // Keep original if parsing fails
          console.error(`Failed to parse hastJson for variant ${variant}:`, error);
          parsed[variant] = variantCode;
        }
      } else {
        // Already parsed or no source to parse - but still check extraFiles
        const parsedExtraFiles = variantCode.extraFiles
          ? Object.fromEntries(
              Object.entries(variantCode.extraFiles).map(([fileName, fileContent]) => {
                if (typeof fileContent === 'string') {
                  return [fileName, fileContent]; // Keep string as-is
                }
                if (fileContent && typeof fileContent === 'object' && fileContent.source) {
                  if (typeof fileContent.source === 'string') {
                    // Parse string source in extraFile
                    try {
                      const parsedHastNodes = parseSource(fileContent.source, fileName);
                      return [fileName, { ...fileContent, source: parsedHastNodes }];
                    } catch (error) {
                      return [fileName, fileContent]; // Keep original if parsing fails
                    }
                  }
                }
                return [fileName, fileContent]; // Keep as-is for other cases
              }),
            )
          : undefined;

        parsed[variant] = {
          ...variantCode,
          extraFiles: parsedExtraFiles,
        };
      }
    }
  }

  return parsed;
}
