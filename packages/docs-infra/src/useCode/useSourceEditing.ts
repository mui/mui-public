import * as React from 'react';
import type { Position } from 'use-editable';
import type {
  Code,
  ControlledCode,
  ControlledVariantExtraFiles,
  VariantCode,
} from '../CodeHighlighter/types';
import type { CodeHighlighterContextType } from '../CodeHighlighter/CodeHighlighterContext';
import { stringOrHastToString } from '../pipeline/hastUtils';

export type { Position };

interface UseSourceEditingProps {
  context?: CodeHighlighterContextType;
  selectedVariantKey: string;
  effectiveCode: Code;
  selectedVariant: VariantCode | null;
  disabled?: boolean;
}

export interface UseSourceEditingResult {
  setSource?: (source: string, fileName?: string, position?: Position) => void;
}

/**
 * Converts Code to ControlledCode, normalizing sources and extraFiles entries.
 * VariantSource can be HAST nodes; ControlledCode requires plain strings.
 * VariantExtraFiles allows plain string entries; ControlledVariantExtraFiles
 * requires `{ source }` objects. Without this normalization, parseControlledCode
 * reads `.source` on a string and gets `undefined`, dropping file content.
 */
function toControlledCode(code: Code): ControlledCode {
  const result: ControlledCode = {};
  for (const [key, variant] of Object.entries(code)) {
    if (!variant || typeof variant === 'string') {
      continue;
    }
    const source = variant.source != null ? stringOrHastToString(variant.source) : variant.source;

    let extraFiles: ControlledVariantExtraFiles | undefined;
    if (variant.extraFiles) {
      extraFiles = {};
      for (const [fileName, entry] of Object.entries(variant.extraFiles)) {
        if (typeof entry === 'string') {
          extraFiles[fileName] = { source: entry };
        } else {
          extraFiles[fileName] = {
            source: entry.source != null ? stringOrHastToString(entry.source) : null,
          };
        }
      }
    }

    result[key] = {
      ...variant,
      source,
      ...(extraFiles ? { extraFiles } : {}),
    } as ControlledCode[string];
  }
  return result;
}

/**
 * Hook for managing source code editing functionality.
 *
 * Returns a `setSource(source, fileName?)` callback that updates the correct file
 * (main or extra) within the controlled code for the current variant.
 * If `fileName` is omitted, the currently selected file is assumed.
 */
export function useSourceEditing({
  context,
  selectedVariantKey,
  effectiveCode,
  selectedVariant,
  disabled,
}: UseSourceEditingProps): UseSourceEditingResult {
  const contextSetCode = context?.setCode;

  const setSource = React.useCallback(
    (source: string, fileName?: string) => {
      if (!contextSetCode) {
        console.warn(
          'setCode is not available in the current context. Ensure you are using CodeControllerContext.',
        );
        return;
      }

      contextSetCode((currentCode: ControlledCode | undefined) => {
        const newCode: ControlledCode = currentCode
          ? { ...currentCode }
          : toControlledCode(effectiveCode);

        const variant = newCode[selectedVariantKey];
        if (!variant) {
          return newCode;
        }

        const effectiveFileName = fileName ?? selectedVariant?.fileName;
        const isMainFile = effectiveFileName === selectedVariant?.fileName;

        if (isMainFile) {
          newCode[selectedVariantKey] = {
            ...variant,
            source,
          };
        } else if (effectiveFileName) {
          newCode[selectedVariantKey] = {
            ...variant,
            extraFiles: {
              ...variant.extraFiles,
              [effectiveFileName]: { source },
            },
          };
        }

        return newCode;
      });
    },
    [contextSetCode, selectedVariantKey, effectiveCode, selectedVariant],
  );

  const isEditable = !disabled && Boolean(contextSetCode) && Boolean(selectedVariant);

  return {
    setSource: isEditable ? setSource : undefined,
  };
}
