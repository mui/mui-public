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

  const [selectedVariantKey, setSelectedVariantKey] = React.useState<string>(
    initialVariant || variantKeys[0] || '',
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
      setSelectedVariantKey(variantKeys[0]);
    }
  }, [selectedVariant, variantKeys]);

  return {
    variantKeys,
    selectedVariantKey,
    selectedVariant,
    selectVariant: setSelectedVariantKey,
  };
}
