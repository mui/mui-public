import * as React from 'react';
import type { Code, VariantCode } from '../CodeHighlighter/types';
import useLocalStorageState from '../useLocalStorageState';

interface UseVariantSelectionProps {
  effectiveCode: Code;
  initialVariant?: string;
}

export interface UseVariantSelectionResult {
  variantKeys: string[];
  selectedVariantKey: string;
  selectedVariant: VariantCode | null;
  selectVariant: React.Dispatch<React.SetStateAction<string>>;
}

/**
 * Hook for managing variant selection and providing variant-related data
 * Uses the useLocalStorage hook for local storage persistence of variant preferences
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

  // Use localStorage hook for variant persistence - this is our single source of truth
  const [storedValue, setStoredValue] = useLocalStorageState(storageKey, () => {
    // Don't use initialVariant as the fallback - localStorage should take precedence
    // We'll handle the initial variant separately in the selectedVariantKey logic
    return null;
  });

  // Handle validation manually - localStorage should take precedence over initialVariant
  const selectedVariantKey = React.useMemo(() => {
    // First priority: use stored value if it exists and is valid
    if (storedValue && variantKeys.includes(storedValue)) {
      return storedValue;
    }

    // Second priority: use initial variant if provided and valid (only when no localStorage value)
    if (initialVariant && variantKeys.includes(initialVariant)) {
      return initialVariant;
    }

    // Final fallback: use first available variant
    return variantKeys[0] || '';
  }, [storedValue, variantKeys, initialVariant]);

  const setSelectedVariantKey = React.useCallback(
    (value: string) => {
      setStoredValue(value);
    },
    [setStoredValue],
  );

  const setSelectedVariantKeyAsUser = React.useCallback(
    (value: React.SetStateAction<string>) => {
      const resolvedValue = typeof value === 'function' ? value(selectedVariantKey) : value;
      setStoredValue(resolvedValue);
    },
    [setStoredValue, selectedVariantKey],
  );

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
      // Use setValue instead of setValueAsUserSelection to avoid localStorage save
      setSelectedVariantKey(variantKeys[0]);
    }
  }, [selectedVariant, variantKeys, setSelectedVariantKey]);

  return {
    variantKeys,
    selectedVariantKey,
    selectedVariant,
    selectVariant: setSelectedVariantKeyAsUser,
  };
}
