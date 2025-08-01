import * as React from 'react';
import type { ControlledCode } from '../CodeHighlighter/types';

interface UseSourceEditingProps {
  context?: any;
  selectedVariantKey: string;
  effectiveCode: any;
  selectedVariant: any;
}

export interface UseSourceEditingResult {
  setSource?: (source: string) => void;
}

/**
 * Hook for managing source code editing functionality
 */
export function useSourceEditing({
  context,
  selectedVariantKey,
  effectiveCode,
  selectedVariant,
}: UseSourceEditingProps): UseSourceEditingResult {
  const contextSetCode = context?.setCode;

  const setSource = React.useCallback(
    (source: string) => {
      if (contextSetCode) {
        contextSetCode((currentCode: any) => {
          let newCode: ControlledCode = {};
          if (!currentCode) {
            newCode = { ...effectiveCode } as ControlledCode; // TODO: ensure all source are strings
          }

          newCode[selectedVariantKey] = {
            ...(newCode[selectedVariantKey] || selectedVariant),
            source,
            extraFiles: {},
          } as ControlledCode[string];

          return newCode;
        });
      } else {
        console.warn(
          'setCode is not available in the current context. Ensure you are using CodeControllerContext.',
        );
      }
    },
    [contextSetCode, selectedVariantKey, effectiveCode, selectedVariant],
  );

  return {
    setSource: contextSetCode ? setSource : undefined,
  };
}
