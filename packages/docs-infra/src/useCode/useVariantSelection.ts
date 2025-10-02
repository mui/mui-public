import * as React from 'react';
import type { Code, VariantCode } from '../CodeHighlighter/types';
import { usePreference } from '../usePreference';
import { useUrlHashState } from '../useUrlHashState';
import { isHashRelevantToDemo } from './useFileNavigation';

interface UseVariantSelectionProps {
  effectiveCode: Code;
  initialVariant?: string;
  variantType?: string;
  mainSlug?: string;
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
  mainSlug,
}: UseVariantSelectionProps): UseVariantSelectionResult {
  // Get variant keys from effective code
  const variantKeys = React.useMemo(() => {
    return Object.keys(effectiveCode).filter((key) => {
      const variant = effectiveCode[key];
      return variant && typeof variant === 'object' && 'source' in variant;
    });
  }, [effectiveCode]);

  // Check if there's a URL hash present that's relevant to this demo
  // Only override localStorage if hash starts with this demo's slug
  const [urlHash] = useUrlHashState();
  const hasRelevantUrlHash = React.useMemo(() => isHashRelevantToDemo(urlHash, mainSlug), [urlHash, mainSlug]);

  // Use localStorage hook for variant persistence
  const [storedValue, setStoredValue] = usePreference('variant', variantType || variantKeys, () => {
    return null;
  });

  // Initialize state - will be updated by effect if localStorage should be used
  const [selectedVariantKey, setSelectedVariantKeyState] = React.useState(() => {
    // Use initial variant if provided and valid
    if (initialVariant && variantKeys.includes(initialVariant)) {
      return initialVariant;
    }

    // Final fallback: use first available variant
    return variantKeys[0] || '';
  });

  // On mount, check if we should restore from localStorage
  // This needs to be in an effect because we need to check hasRelevantUrlHash which depends on urlHash
  const [hasInitialized, setHasInitialized] = React.useState(false);
  React.useEffect(() => {
    if (hasInitialized) {
      return;
    }
    setHasInitialized(true);

    // If there's a relevant URL hash, don't use localStorage - hash takes priority
    if (hasRelevantUrlHash) {
      return;
    }

    // If we have a stored value, use it (localStorage takes priority over initialVariant)
    if (storedValue && variantKeys.includes(storedValue)) {
      setSelectedVariantKeyState(storedValue);
    }
  }, [hasInitialized, hasRelevantUrlHash, storedValue, variantKeys]);

  // Sync with localStorage changes (but don't override programmatic changes or when hash is present)
  // Only sync when storedValue changes, not when selectedVariantKey changes
  const prevStoredValue = React.useRef(storedValue);
  React.useEffect(() => {
    // Don't sync from localStorage when a relevant URL hash is present - hash takes absolute priority
    if (hasRelevantUrlHash) {
      return;
    }
    if (storedValue !== prevStoredValue.current) {
      prevStoredValue.current = storedValue;
      if (storedValue && variantKeys.includes(storedValue) && storedValue !== selectedVariantKey) {
        setSelectedVariantKeyState(storedValue);
      }
    }
  }, [storedValue, variantKeys, selectedVariantKey, hasRelevantUrlHash]);

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
