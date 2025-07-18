import * as React from 'react';
import { sha256 } from 'js-sha256';
import { useCodeContext } from '../CodeProvider/CodeContext';
import { useOnHydrate } from '../useOnHydrate';
import { useOnIdle } from '../useOnIdle';
import { Code } from './types';
import { stringOrHastToString } from '../hast/hast';

const DEBUG = false; // Set to true for debugging purposes

// Helper function to convert a single variant to strings
function convertVariantToStrings(variant: Code[string]): Code[string] {
  if (typeof variant === 'string') {
    return variant;
  }

  if (!variant || typeof variant.source === 'string') {
    return variant;
  }

  const convertedVariant = {
    ...variant,
    source: variant.source ? stringOrHastToString(variant.source) : '',
  };

  // Convert extra files if they exist
  if (variant.extraFiles) {
    convertedVariant.extraFiles = Object.fromEntries(
      Object.entries(variant.extraFiles).map(([fileKey, fileData]) => {
        if (typeof fileData === 'string') {
          return [fileKey, fileData];
        }
        if (
          fileData &&
          typeof fileData === 'object' &&
          'source' in fileData &&
          typeof fileData.source !== 'string'
        ) {
          return [
            fileKey,
            { ...fileData, source: fileData.source ? stringOrHastToString(fileData.source) : '' },
          ];
        }
        return [fileKey, fileData];
      }),
    );
  }

  return convertedVariant;
}

export function useHighlighted({
  highlightAt = 'hydration',
  isControlled,
  activeCode,
  readyForContent,
  variants,
  setCode,
  controlledSetCode,
}: {
  readyForContent: boolean;
  highlightAt?: 'init' | 'hydration' | 'idle';
  isControlled: boolean;
  activeCode?: Code;
  variants: string[];
  setCode: React.Dispatch<React.SetStateAction<Code | undefined>>;
  controlledSetCode?: React.Dispatch<React.SetStateAction<Code | undefined>>;
}) {
  const context = useCodeContext();
  const { parseSource } = context || {};
  const isHydrated = useOnHydrate();
  const isIdle = useOnIdle();
  const [overlaidCode, setOverlaidCode] = React.useState<Code | undefined>();

  // Store parsed content to avoid re-parsing.
  const parsedContent = React.useRef<Map<string, any>>(new Map());

  // Determine if we're ready to highlight based on highlightAt setting
  const isReadyToHighlight = React.useMemo(() => {
    if (highlightAt === 'init') {
      return true;
    }
    if (highlightAt === 'hydration') {
      return isHydrated;
    }
    if (highlightAt === 'idle') {
      return isIdle;
    }
    return false;
  }, [highlightAt, isHydrated, isIdle]);

  // Handle highlighted code that needs to be converted to strings for delayed highlighting
  const shouldConvertToStrings = React.useMemo(() => {
    return activeCode && !isReadyToHighlight;
  }, [activeCode, isReadyToHighlight]);

  // Convert highlighted code to strings for the overlay when highlighting is delayed
  const stringOverlay = React.useMemo(() => {
    if (!shouldConvertToStrings || !activeCode) {
      return undefined;
    }

    const stringCode: Code = {};
    for (const [variantKey, variant] of Object.entries(activeCode)) {
      stringCode[variantKey] = convertVariantToStrings(variant);
    }
    return stringCode;
  }, [shouldConvertToStrings, activeCode]);

  // Function to highlight code variants
  const highlightCode = React.useCallback(
    async (codeToHighlight: Code) => {
      if (!parseSource || typeof parseSource !== 'function') {
        throw new Error('parseSource is not provided or is not a function');
      }

      let hasChanges = false; // Track if any actual parsing work was done
      const newlyParsedContent = new Map<string, any>(); // Track parsed content for this run

      const result = await Promise.all(
        variants.map(async (name) => {
          const codeVariant = codeToHighlight?.[name];
          if (!codeVariant) {
            // Skip missing variants gracefully
            return { variant: name, error: new Error(`Variant is missing from code: ${name}`) };
          }

          if (typeof codeVariant === 'string') {
            return { variant: name, error: new Error(`Variant is missing from code: ${name}`) };
          }

          // Only highlight if source is a string (needs highlighting)
          if (typeof codeVariant?.source === 'string') {
            const sourceHash = `${codeVariant.fileName}:${sha256(codeVariant.source)}`;

            // Check if content is already parsed
            if (parsedContent.current.has(sourceHash)) {
              const parsedSource = parsedContent.current.get(sourceHash);
              newlyParsedContent.set(sourceHash, parsedSource); // Carry over to new map
              return { variant: name, code: { ...codeVariant, source: parsedSource } };
            }

            hasChanges = true; // Mark that we're doing actual parsing work
            let parsedSource;
            try {
              parsedSource = await parseSource(codeVariant.source, codeVariant.fileName);
              newlyParsedContent.set(sourceHash, parsedSource); // Add to new map
            } catch (error) {
              return {
                variant: name,
                error:
                  error instanceof Error
                    ? error
                    : new Error(`Failed to parse source: ${String(error)}`),
              };
            }

            const updatedVariant = { ...codeVariant, source: parsedSource };

            // Handle extra files that need highlighting
            if (codeVariant.extraFiles) {
              const extraFiles = { ...codeVariant.extraFiles };
              const filePromises = Object.entries(extraFiles).map(async ([fileName, fileData]) => {
                if (typeof fileData === 'string') {
                  const fileHash = `${fileName}:${sha256(fileData)}`;

                  // Check if content is already parsed
                  if (parsedContent.current.has(fileHash)) {
                    const parsedFile = parsedContent.current.get(fileHash);
                    newlyParsedContent.set(fileHash, parsedFile); // Carry over
                    return { fileName, data: { source: parsedFile } };
                  }

                  hasChanges = true; // Mark that we're doing actual parsing work
                  try {
                    const parsedFile = await parseSource(fileData, fileName);
                    newlyParsedContent.set(fileHash, parsedFile); // Add to new map
                    // For string files, we need to wrap the parsed result in an object
                    return { fileName, data: { source: parsedFile } };
                  } catch (error) {
                    return {
                      fileName,
                      data: fileData,
                      error:
                        error instanceof Error
                          ? error
                          : new Error(`Failed to parse file ${fileName}: ${String(error)}`),
                    };
                  }
                }

                if (fileData && typeof fileData.source === 'string') {
                  const fileHash = `${fileName}:${sha256(fileData.source)}`;

                  // Check if content is already parsed
                  if (parsedContent.current.has(fileHash)) {
                    const parsedFile = parsedContent.current.get(fileHash);
                    newlyParsedContent.set(fileHash, parsedFile); // Carry over
                    return { fileName, data: { ...fileData, source: parsedFile } };
                  }

                  hasChanges = true; // Mark that we're doing actual parsing work
                  try {
                    const parsedFile = await parseSource(fileData.source, fileName);
                    newlyParsedContent.set(fileHash, parsedFile); // Add to new map
                    return { fileName, data: { ...fileData, source: parsedFile } };
                  } catch (error) {
                    return {
                      fileName,
                      data: fileData,
                      error:
                        error instanceof Error
                          ? error
                          : new Error(`Failed to parse file ${fileName}: ${String(error)}`),
                    };
                  }
                }

                return { fileName, data: fileData };
              });

              const resolvedFiles = await Promise.all(filePromises);
              for (const { fileName, data, error } of resolvedFiles) {
                if (error) {
                  return { variant: name, error };
                }
                extraFiles[fileName] = data;
              }
              updatedVariant.extraFiles = extraFiles;
            }

            return { variant: name, code: updatedVariant };
          }

          // If source is not a string, it's already highlighted - return as-is
          return { variant: name, code: codeVariant };
        }),
      );

      const resultCode: Code = {};
      const errors: Error[] = [];
      for (const variant of result) {
        if ('error' in variant && variant.error) {
          // Only add to errors if it's not a missing variant error
          if (
            !(
              variant.error instanceof Error &&
              variant.error.message.includes('Variant is missing from code:')
            )
          ) {
            errors.push(variant.error);
          }
        } else if (variant.code) {
          resultCode[variant.variant] = variant.code;
        }
      }

      if (errors.length > 0) {
        throw errors[0];
      }

      // The new map becomes the current map of parsed content.
      // This ensures that if code is removed, its parsed content is also removed.
      parsedContent.current = newlyParsedContent;

      return { resultCode, hasChanges };
    },
    [variants, parseSource],
  );

  // Ensure all the code is highlighted
  React.useEffect(() => {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.log('useHighlighted effect triggered with:', {
        readyForContent,
        isReadyToHighlight,
        activeCode: activeCode ? 'present' : 'missing',
      });
    }

    if (!readyForContent || !isReadyToHighlight) {
      return undefined;
    }

    const abortController = new AbortController();

    const highlightAsync = async () => {
      if (!activeCode) {
        return;
      }

      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.log('useHighlighted: Starting highlighting process for variants:', variants);
      }

      try {
        const result = await highlightCode(activeCode);

        // Check if the operation was aborted
        if (abortController.signal.aborted) {
          if (DEBUG) {
            // eslint-disable-next-line no-console
            console.log('useHighlighted: Highlighting was aborted');
          }
          return;
        }

        // Only update state if there were actual changes
        if (result.hasChanges) {
          if (DEBUG) {
            // eslint-disable-next-line no-console
            console.log('useHighlighted: Highlighting completed with changes');
          }

          // First update overlaidCode to show highlighted content immediately
          setOverlaidCode(result.resultCode);

          // Then update the main code state for controlled components
          if (!isControlled) {
            setCode(result.resultCode);
          }
        } else if (DEBUG) {
          // eslint-disable-next-line no-console
          console.log('useHighlighted: No changes detected, skipping state update');
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }
        // TODO: handle error
        console.error('Error highlighting code:', error);
      }
    };

    highlightAsync();

    return () => {
      abortController.abort();
    };
  }, [
    isControlled,
    activeCode,
    isReadyToHighlight,
    readyForContent,
    variants,
    setCode,
    highlightCode,
  ]);

  // Clear the string overlay when highlighting is complete
  React.useEffect(() => {
    if (isReadyToHighlight && stringOverlay) {
      // Clear the string overlay since we now have proper highlighting
      // The overlaidCode will take precedence in the return statement
    }
  }, [isReadyToHighlight, stringOverlay]);

  // Create a custom setCode function that handles highlighting before updating controlled state
  const contextSetCode = React.useCallback(
    async (newCodeOrUpdater: React.SetStateAction<Code | undefined>) => {
      if (!controlledSetCode) {
        // Should not happen since we only expose this when controlled
        return;
      }

      // Handle both direct values and updater functions
      const newCode =
        typeof newCodeOrUpdater === 'function' ? newCodeOrUpdater(activeCode) : newCodeOrUpdater;

      if (!newCode) {
        controlledSetCode(newCode);
        return;
      }

      // If newCode contains strings, we need to highlight them first
      const hasStringSource = Object.values(newCode).some(
        (variant) => variant && typeof variant !== 'string' && typeof variant.source === 'string',
      );

      if (hasStringSource) {
        try {
          // Highlight the code first
          const result = await highlightCode(newCode);

          // Only update state if there were actual changes
          if (result.hasChanges) {
            // Update overlaid code with highlighted version
            setOverlaidCode(result.resultCode);

            // Update controlled state with highlighted code
            controlledSetCode(result.resultCode);
          }
        } catch (error) {
          console.error('Error highlighting code in contextSetCode:', error);

          // Fall back to showing the original code in overlaid state
          setOverlaidCode(newCode);

          // And update controlled state with the original code
          controlledSetCode(newCode);
        }
      } else {
        // If already highlighted, update both overlaid and controlled state
        setOverlaidCode(newCode);
        controlledSetCode(newCode);
      }
    },
    [controlledSetCode, activeCode, setOverlaidCode, highlightCode],
  );

  return {
    overlaidCode: stringOverlay || overlaidCode,
    setOverlaidCode,
    contextSetCode: controlledSetCode ? contextSetCode : undefined,
  };
}
