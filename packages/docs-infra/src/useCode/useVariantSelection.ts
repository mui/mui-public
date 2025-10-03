import * as React from 'react';
import type { Code, VariantCode } from '../CodeHighlighter/types';
import { usePreference } from '../usePreference';

interface UseVariantSelectionProps {
  effectiveCode: Code;
  initialVariant?: string;
  variantType?: string;
}

export interface UseVariantSelectionResult {
  variantKeys: string[];
  selectedVariantKey: string;
  selectedVariant: VariantCode | null;
  selectVariant: React.Dispatch<React.SetStateAction<string>>;
  selectVariantProgrammatic: React.Dispatch<React.SetStateAction<string>>;
}

/**
 * Hook for managing variant selection and providing variant-related data
 * Uses React state as source of truth, with localStorage for persistence
 */
export function useVariantSelection({
  effectiveCode,
  initialVariant,
  variantType,
}: UseVariantSelectionProps): UseVariantSelectionResult {
  // Get variant keys from effective code
  const variantKeys = React.useMemo(() => {
    return Object.keys(effectiveCode).filter((key) => {
      const variant = effectiveCode[key];
      return variant && typeof variant === 'object' && 'source' in variant;
    });
  }, [effectiveCode]);

  // Use localStorage hook for variant persistence
  const [storedValue, setStoredValue] = usePreference('variant', variantType || variantKeys, () => {
    return null;
  });

  // Initialize state from localStorage or initialVariant
  const [selectedVariantKey, setSelectedVariantKeyState] = React.useState(() => {
    // First priority: use stored value if it exists and is valid
    if (storedValue && variantKeys.includes(storedValue)) {
      return storedValue;
    }

    // Second priority: use initial variant if provided and valid
    if (initialVariant && variantKeys.includes(initialVariant)) {
      return initialVariant;
    }

    // Final fallback: use first available variant
    return variantKeys[0] || '';
  });

  // Sync with localStorage changes (but don't override programmatic changes)
  // Only sync when storedValue changes, not when selectedVariantKey changes
  const prevStoredValue = React.useRef(storedValue);
  React.useEffect(() => {
    if (storedValue !== prevStoredValue.current) {
      prevStoredValue.current = storedValue;
      if (storedValue && variantKeys.includes(storedValue) && storedValue !== selectedVariantKey) {
        setSelectedVariantKeyState(storedValue);
      }
    }
  }, [storedValue, variantKeys, selectedVariantKey]);

  const setSelectedVariantKeyProgrammatic = React.useCallback(
    (value: React.SetStateAction<string>) => {
      const resolvedValue = typeof value === 'function' ? value(selectedVariantKey) : value;
      if (variantKeys.includes(resolvedValue)) {
        // Only update React state, not localStorage
        // This prevents conflicts with hash-driven navigation
        setSelectedVariantKeyState(resolvedValue);
      }
    },
    [selectedVariantKey, variantKeys],
  );

  const setSelectedVariantKeyAsUser = React.useCallback(
    (value: React.SetStateAction<string>) => {
      const resolvedValue = typeof value === 'function' ? value(selectedVariantKey) : value;
      if (variantKeys.includes(resolvedValue)) {
        setSelectedVariantKeyState(resolvedValue);
        setStoredValue(resolvedValue);
      }
    },
    [setStoredValue, selectedVariantKey, variantKeys],
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
      // Use programmatic setter to avoid localStorage save
      setSelectedVariantKeyProgrammatic(variantKeys[0]);
    }
  }, [selectedVariant, variantKeys, setSelectedVariantKeyProgrammatic]);

  return {
    variantKeys,
    selectedVariantKey,
    selectedVariant,
    selectVariant: setSelectedVariantKeyAsUser,
    selectVariantProgrammatic: setSelectedVariantKeyProgrammatic,
  };
}
