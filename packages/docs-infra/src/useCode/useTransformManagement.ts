import * as React from 'react';
import type { Code } from '../CodeHighlighter/types';
import { getAvailableTransforms, createTransformedFiles } from './useCodeUtils';

interface UseTransformManagementProps {
  context?: any;
  effectiveCode: Code;
  selectedVariantKey: string;
  selectedVariant: any;
  initialTransform?: string;
}

export interface UseTransformManagementResult {
  availableTransforms: string[];
  selectedTransform: string | null;
  transformedFiles: any; // TransformedFiles | undefined from utils
  selectTransform: (transformName: string | null) => void;
}

/**
 * Hook for managing code transforms and their application
 */
export function useTransformManagement({
  context,
  effectiveCode,
  selectedVariantKey,
  selectedVariant,
  initialTransform,
}: UseTransformManagementProps): UseTransformManagementResult {
  // Transform state - get available transforms from context or from the effective code data
  const availableTransforms = React.useMemo(() => {
    // First try to get from context
    if (context?.availableTransforms && context.availableTransforms.length > 0) {
      return context.availableTransforms;
    }

    // Otherwise, get from the effective code data using the utility function
    return getAvailableTransforms(effectiveCode, selectedVariantKey);
  }, [context?.availableTransforms, effectiveCode, selectedVariantKey]);

  const [selectedTransform, setSelectedTransform] = React.useState<string | null>(
    initialTransform || null,
  );

  // Memoize all transformed files based on selectedTransform
  const transformedFiles = React.useMemo(() => {
    return createTransformedFiles(selectedVariant, selectedTransform);
  }, [selectedVariant, selectedTransform]);

  // Function to switch to a specific transform
  const selectTransform = React.useCallback(
    (transformName: string | null) => {
      if (!transformName || availableTransforms.includes(transformName)) {
        setSelectedTransform(transformName);
      } else {
        setSelectedTransform(null);
      }
    },
    [availableTransforms],
  );

  return {
    availableTransforms,
    selectedTransform,
    transformedFiles,
    selectTransform,
  };
}
