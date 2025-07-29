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
 * Includes local storage persistence for transform preferences
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

  // Generate storage key from sorted available transforms
  const storageKey = React.useMemo(() => {
    if (availableTransforms.length === 0) {
      return null; // Don't use localStorage when no transforms are available
    }
    const sortedTransforms = [...availableTransforms].sort();
    return `_docs_infra_transform_prefs_${sortedTransforms.join(':')}`;
  }, [availableTransforms]);

  const [selectedTransform, setSelectedTransform] = React.useState<string | null>(
    initialTransform || null,
  );

  // Track if we've synced from localStorage to avoid re-running
  const hasSyncedFromStorage = React.useRef(false);
  // Track if the user has made an explicit selection change
  const hasUserSelection = React.useRef(false);

  // Sync from localStorage on hydration (runs only once)
  // Only sync if no initialTransform was explicitly provided
  React.useEffect(() => {
    if (
      hasSyncedFromStorage.current ||
      !storageKey ||
      typeof window === 'undefined' ||
      initialTransform
    ) {
      hasSyncedFromStorage.current = true; // Mark as synced even if we skip due to initialTransform
      return;
    }

    try {
      const storedTransform = localStorage.getItem(storageKey);
      if (storedTransform !== null) {
        // Check if it's a valid transform or "null" (meaning no transform)
        if (storedTransform === 'null') {
          setSelectedTransform(null);
        } else if (availableTransforms.includes(storedTransform)) {
          setSelectedTransform(storedTransform);
        }
      }
    } catch (error) {
      // Ignore localStorage errors (e.g., in private browsing mode)
      console.warn('Failed to read transform preference from localStorage:', error);
    }

    hasSyncedFromStorage.current = true;
  }, [storageKey, availableTransforms, initialTransform]);

  // Save to localStorage only when user makes explicit selection changes
  React.useEffect(() => {
    if (
      !hasUserSelection.current ||
      !hasSyncedFromStorage.current ||
      !storageKey ||
      typeof window === 'undefined'
    ) {
      return;
    }

    try {
      // Store the selected transform, or "null" if no transform is selected
      const valueToStore = selectedTransform || 'null';
      localStorage.setItem(storageKey, valueToStore);
    } catch (error) {
      // Ignore localStorage errors (e.g., in private browsing mode)
      console.warn('Failed to save transform preference to localStorage:', error);
    }
  }, [selectedTransform, storageKey]);

  // Memoize all transformed files based on selectedTransform
  const transformedFiles = React.useMemo(() => {
    return createTransformedFiles(selectedVariant, selectedTransform);
  }, [selectedVariant, selectedTransform]);

  // Function to switch to a specific transform
  // Wrapper function to mark user selections
  const selectTransform = React.useCallback(
    (transformName: string | null) => {
      hasUserSelection.current = true;
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
