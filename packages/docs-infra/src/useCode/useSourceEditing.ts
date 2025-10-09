import * as React from 'react';
import type { Code, ControlledCode, VariantCode } from '../CodeHighlighter/types';
import type { CodeHighlighterContextType } from '../CodeHighlighter/CodeHighlighterContext';

interface UseSourceEditingProps {
  context?: CodeHighlighterContextType;
  selectedVariantKey: string;
  effectiveCode: Code;
  selectedVariant: VariantCode | null;
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
        contextSetCode((currentCode: ControlledCode | undefined) => {
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
