import * as React from 'react';
import type { Code } from '../CodeHighlighter/types';
import { useLocalStorage } from '../useLocalStorage';

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
  const {
    value: selectedVariantKey,
    setValue: setSelectedVariantKey,
    setValueAsUserSelection: setSelectedVariantKeyAsUser,
  } = useLocalStorage({
    initialValue: initialVariant || variantKeys[0] || '',
    storageKey,
    skipInitialSync: !!initialVariant, // Skip initial sync if an explicit initial variant was provided
    isValidValue: (value: string) => variantKeys.includes(value),
  });

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
