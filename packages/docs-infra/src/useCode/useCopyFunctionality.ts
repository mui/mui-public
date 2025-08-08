import * as React from 'react';
import { stringOrHastToString } from '../pipeline/hastUtils';
import { useCopier, UseCopierOpts } from '../useCopier';
import { VariantSource } from '../CodeHighlighter';

interface UseCopyFunctionalityProps {
  selectedFile: VariantSource | null;
  copyOpts?: UseCopierOpts;
}

export interface UseCopyFunctionalityResult {
  copy: (event: React.MouseEvent<HTMLButtonElement>) => Promise<void>;
}

/**
 * Hook for managing copy-to-clipboard functionality
 */
export function useCopyFunctionality({
  selectedFile,
  copyOpts,
}: UseCopyFunctionalityProps): UseCopyFunctionalityResult {
  const sourceFileToText = React.useCallback((): string | undefined => {
    if (!selectedFile) {
      return undefined;
    }

    if (typeof selectedFile === 'string') {
      return selectedFile;
    }

    if (selectedFile && typeof selectedFile === 'object' && 'hastJson' in selectedFile) {
      return selectedFile.hastJson;
    }

    return stringOrHastToString(selectedFile);
  }, [selectedFile]);

  const { copy } = useCopier(sourceFileToText, copyOpts);

  return {
    copy,
  };
}
