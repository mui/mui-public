import * as React from 'react';
import type { Code } from '../CodeHighlighter/types';

interface UseVariantSelectionProps {
  effectiveCode: Code;
  initialVariant?: string;
}

export interface UseVariantSelectionResult {
  variantKeys: string[];
  selectedVariantKey: string;
  selectedVariant: any;
  selectVariant: React.Dispatch<React.SetStateAction<string>>;
}

/**
 * Hook for managing variant selection and providing variant-related data
 * Includes local storage persistence for variant preferences
 */
export function useVariantSelection({
  effectiveCode,
  initialVariant,
}: UseVariantSelectionProps): UseVariantSelectionResult {
  // Get variant keys from effective code
  const variantKeys = React.useMemo(() => {
    return Object.keys(effectiveCode).filter((key) => {
      const variant = effectiveCode[key];
      return variant && typeof variant === 'object' && 'source' in variant;
    });
  }, [effectiveCode]);

  // Generate storage key from sorted variant keys (only for multiple variants)
  const storageKey = React.useMemo(() => {
    if (variantKeys.length <= 1) {
      return null; // Don't use localStorage for single variants - no choice to remember
    }
    const sortedKeys = [...variantKeys].sort();
    return `_docs_infra_variant_prefs_${sortedKeys.join(':')}`;
  }, [variantKeys]);

  const [selectedVariantKey, setSelectedVariantKey] = React.useState<string>(
    initialVariant || variantKeys[0] || '',
  );

  // Track if we've synced from localStorage to avoid re-running
  const hasSyncedFromStorage = React.useRef(false);
  // Track if the user has made an explicit selection change
  const hasUserSelection = React.useRef(false);

  // Sync from localStorage on hydration (runs only once)
  // Only sync if no initialVariant was explicitly provided
  React.useEffect(() => {
    if (
      hasSyncedFromStorage.current ||
      !storageKey ||
      typeof window === 'undefined' ||
      initialVariant
    ) {
      hasSyncedFromStorage.current = true; // Mark as synced even if we skip due to initialVariant
      return;
    }

    try {
      const storedVariant = localStorage.getItem(storageKey);
      if (storedVariant && variantKeys.includes(storedVariant)) {
        setSelectedVariantKey(storedVariant);
      }
    } catch (error) {
      // Ignore localStorage errors (e.g., in private browsing mode)
      console.warn('Failed to read variant preference from localStorage:', error);
    }

    hasSyncedFromStorage.current = true;
  }, [storageKey, variantKeys, initialVariant]);

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
      localStorage.setItem(storageKey, selectedVariantKey);
    } catch (error) {
      // Ignore localStorage errors (e.g., in private browsing mode)
      console.warn('Failed to save variant preference to localStorage:', error);
    }
  }, [selectedVariantKey, storageKey]);

  const selectedVariant = React.useMemo(() => {
    const variant = effectiveCode[selectedVariantKey];
    if (variant && typeof variant === 'object' && 'source' in variant) {
      return variant;
    }
    return null;
  }, [effectiveCode, selectedVariantKey]);

  // Safety check: if selectedVariant doesn't exist, fall back to first variant
  React.useEffect(() => {
    if (!selectedVariant && variantKeys.length > 0) {
      // Don't mark this as a user selection - it's just a fallback
      setSelectedVariantKey(variantKeys[0]);
    }
  }, [selectedVariant, variantKeys]);

  // Wrapper function to mark user selections
  const selectVariant = React.useCallback((value: React.SetStateAction<string>) => {
    hasUserSelection.current = true;
    setSelectedVariantKey(value);
  }, []);

  return {
    variantKeys,
    selectedVariantKey,
    selectedVariant,
    selectVariant,
  };
}
