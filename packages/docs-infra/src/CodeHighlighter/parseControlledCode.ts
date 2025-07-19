import type { Code, ControlledCode, ParseSource } from './types';

/**
 * Pure function to parse controlled code and convert it to regular Code format.
 * Handles the conversion from ControlledCode (string|null sources) to Code (HAST nodes).
 */
export function parseControlledCode(
  controlledCode: ControlledCode,
  parseSource: ParseSource,
): Code {
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
      
      if (typeof sourceToProcess === 'string') {
        try {
          mainSource = parseSource(sourceToProcess, variantCode.fileName);
        } catch (error) {
          // Keep original string if parsing fails
          mainSource = sourceToProcess;
        }
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
            // Parse string sources
            try {
              const parsedSource = parseSource(fileSourceToProcess, fileName);
              parsedExtraFiles[fileName] = { source: parsedSource };
            } catch (error) {
              // Keep original if parsing fails
              parsedExtraFiles[fileName] = { source: fileSourceToProcess };
            }
          } else {
            // Keep other values as-is
            parsedExtraFiles[fileName] = { source: fileSourceToProcess };
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
      };
    }
  }

  return parsed;
}
