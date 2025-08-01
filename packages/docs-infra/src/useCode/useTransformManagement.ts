import * as React from 'react';
import type { Code } from '../CodeHighlighter/types';
import { getAvailableTransforms, createTransformedFiles } from './useCodeUtils';
import { useLocalStorage } from '../useLocalStorage';

interface UseTransformManagementProps {
  context?: any;
  effectiveCode: Code;
  selectedVariantKey: string;
  selectedVariant: any;
  initialTransform?: string;
  shouldHighlight: boolean;
}

export interface UseTransformManagementResult {
  availableTransforms: string[];
  selectedTransform: string | null;
  transformedFiles: any; // TransformedFiles | undefined from utils
  selectTransform: (transformName: string | null) => void;
}

/**
 * Hook for managing code transforms and their application
 * Uses the useLocalStorage hook for local storage persistence of transform preferences
 */
export function useTransformManagement({
  context,
  effectiveCode,
  selectedVariantKey,
  selectedVariant,
  initialTransform,
  shouldHighlight,
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

  // Generate storage key from sorted available transforms
  const storageKey = React.useMemo(() => {
    if (availableTransforms.length === 0) {
      return null; // Don't use localStorage when no transforms are available
    }
    const sortedTransforms = [...availableTransforms].sort();
    return `_docs_infra_transform_prefs_${sortedTransforms.join(':')}`;
  }, [availableTransforms]);

  // Use localStorage hook for transform persistence - this is our single source of truth
  const { value: selectedTransform, setValueAsUserSelection: setSelectedTransformAsUser } =
    useLocalStorage({
      initialValue: initialTransform || null,
      storageKey,
      skipInitialSync: !!initialTransform, // Skip initial sync if an explicit initial transform was provided
      serialize: (value: string | null) => value || 'null', // Store null as 'null' string
      deserialize: (value: string) => (value === 'null' ? null : value), // Convert 'null' string back to null
      isValidValue: (value: string | null) => value === null || availableTransforms.includes(value),
    });

  // Memoize all transformed files based on selectedTransform
  const transformedFiles = React.useMemo(() => {
    return createTransformedFiles(selectedVariant, selectedTransform, shouldHighlight);
  }, [selectedVariant, selectedTransform, shouldHighlight]);

  return {
    availableTransforms,
    selectedTransform,
    transformedFiles,
    selectTransform: setSelectedTransformAsUser,
  };
}
