import * as React from 'react';
import type { Code, VariantCode } from '../CodeHighlighter/types';
import { getAvailableTransforms, createTransformedFiles } from './useCodeUtils';
import { CodeHighlighterContextType } from '../CodeHighlighter/CodeHighlighterContext';
import { usePreference } from '../usePreference';

interface UseTransformManagementProps {
  context?: CodeHighlighterContextType;
  effectiveCode: Code;
  selectedVariantKey: string;
  selectedVariant: VariantCode | null;
  initialTransform?: string;
  shouldHighlight: boolean;
}

export interface UseTransformManagementResult {
  availableTransforms: string[];
  selectedTransform: string | null;
  transformedFiles: ReturnType<typeof createTransformedFiles>;
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

  // Use localStorage hook for transform persistence - this is our single source of truth
  const [storedValue, setStoredValue] = usePreference(
    'transform',
    availableTransforms.length === 1 ? availableTransforms[0] : availableTransforms,
    () => {
      // Don't use initialTransform as the fallback - localStorage should always take precedence
      // We'll handle the initial transform separately below
      return null;
    },
  );

  // Handle validation manually - empty string means "no transform selected"
  const selectedTransform = React.useMemo(() => {
    // If we have a stored value (including empty string), use it
    if (storedValue !== null) {
      if (storedValue === '') {
        return null;
      }
      // Validate the stored value
      if (!availableTransforms.includes(storedValue)) {
        return null;
      }
      return storedValue;
    }

    // If no stored value and we have an initial transform, use it (but don't store it yet)
    if (initialTransform && availableTransforms.includes(initialTransform)) {
      return initialTransform;
    }

    return null;
  }, [storedValue, availableTransforms, initialTransform]);

  const setSelectedTransformAsUser = React.useCallback(
    (value: string | null) => {
      const valueToStore = value === null ? '' : value;
      setStoredValue(valueToStore);
    },
    [setStoredValue],
  );

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
