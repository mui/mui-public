import * as React from 'react';
import type { Code, VariantCode } from '../CodeHighlighter/types';
import { usePreference } from '../usePreference';
import { useUrlHashState } from '../useUrlHashState';
import { isHashRelevantToDemo, toKebabCase } from './useFileNavigation';

/**
 * Parses the variant name from a URL hash
 * Hash formats:
 * - slug:file.tsx -> "Default"
 * - slug:variant:file.tsx -> "variant"
 * - slug:variant -> "variant"
 * @param urlHash - The URL hash (without '#')
 * @param mainSlug - The main slug for the demo (optional, used to determine if hash is relevant for file selection)
 * @param variantKeys - Available variant keys
 * @returns The variant name or null if not found/parseable
 */
function parseVariantFromHash(
  urlHash: string | null,
  mainSlug: string | undefined,
  variantKeys: string[],
): string | null {
  if (!urlHash) {
    return null;
  }

  const parts = urlHash.split(':');

  // If there are 3 parts (slug:variant:file), the variant is in the middle
  if (parts.length === 3) {
    const variantPart = parts[1];
    // Find matching variant key (case-insensitive kebab match)
    const matchingVariant = variantKeys.find(
      (key) => toKebabCase(key) === variantPart.toLowerCase(),
    );
    return matchingVariant || null;
  }

  // If there are 2 parts, could be slug:variant or slug:file
  if (parts.length === 2) {
    const secondPart = parts[1];
    // Try to match as a variant first
    const matchingVariant = variantKeys.find(
      (key) => toKebabCase(key) === secondPart.toLowerCase(),
    );
    if (matchingVariant) {
      return matchingVariant;
    }
    // If no matching variant and it looks like a filename, assume Default
    if (secondPart.includes('.')) {
      return 'Default';
    }
  }

  // Just the slug with no other parts, assume Default
  if (parts.length === 1) {
    return 'Default';
  }

  return null;
}

interface UseVariantSelectionProps {
  effectiveCode: Code;
  initialVariant?: string;
  variantType?: string;
  mainSlug?: string;
  saveHashVariantToLocalStorage?: 'on-load' | 'on-interaction' | 'never';
}

export interface UseVariantSelectionResult {
  variantKeys: string[];
  selectedVariantKey: string;
  selectedVariant: VariantCode | null;
  selectVariant: React.Dispatch<React.SetStateAction<string | null>>;
  selectVariantProgrammatic: React.Dispatch<React.SetStateAction<string>>;
  saveVariantToLocalStorage: (variant: string) => void;
  hashVariant: string | null;
}

/**
 * Hook for managing variant selection and providing variant-related data
 * Priority: URL hash > localStorage > initialVariant > first variant
 * When hash has a variant, it overrides localStorage and is saved to localStorage
 */
export function useVariantSelection({
  effectiveCode,
  initialVariant,
  variantType,
  mainSlug,
  saveHashVariantToLocalStorage = 'on-interaction',
}: UseVariantSelectionProps): UseVariantSelectionResult {
  // Get variant keys from effective code
  const variantKeys = React.useMemo(() => {
    return Object.keys(effectiveCode).filter((key) => {
      const variant = effectiveCode[key];
      return variant && typeof variant === 'object' && 'source' in variant;
    });
  }, [effectiveCode]);

  // Get URL hash and parse variant from it
  const [urlHash, setUrlHash] = useUrlHashState();
  const hashVariant = React.useMemo(
    () => parseVariantFromHash(urlHash, mainSlug, variantKeys),
    [urlHash, mainSlug, variantKeys],
  );

  // Use localStorage hook for variant persistence
  const [storedValue, setStoredValue] = usePreference('variant', variantType || variantKeys, () => {
    return null;
  });

  // Track if the last change was user-initiated (to prevent hash from overriding)
  const isUserInitiatedChange = React.useRef(false);
  // Track previous hash variant to detect hash changes
  const prevHashVariant = React.useRef<string | null>(hashVariant);
  // Track previous storedValue to detect localStorage changes
  const prevStoredValue = React.useRef<string | null>(storedValue);

  // Determine initial variant: hash > localStorage > initialVariant > first variant
  const [selectedVariantKey, setSelectedVariantKeyState] = React.useState(() => {
    // Priority 1: Hash variant
    if (hashVariant && variantKeys.includes(hashVariant)) {
      return hashVariant;
    }
    // Priority 2: localStorage
    if (storedValue && variantKeys.includes(storedValue)) {
      return storedValue;
    }
    // Priority 3: initialVariant prop
    if (initialVariant && variantKeys.includes(initialVariant)) {
      return initialVariant;
    }
    // Priority 4: First available variant
    return variantKeys[0] || '';
  });

  // Track selected variant key in a ref for use in effect without causing re-runs
  const selectedVariantKeyRef = React.useRef(selectedVariantKey);
  React.useEffect(() => {
    selectedVariantKeyRef.current = selectedVariantKey;
  });

  // When hash changes and has a variant, override current selection
  // When hash is removed, fall back to localStorage
  React.useEffect(() => {
    // Skip if this was a user-initiated change
    if (isUserInitiatedChange.current) {
      // Only reset the flag once the hash has actually been cleared
      if (hashVariant === null && urlHash === null) {
        isUserInitiatedChange.current = false;
      }
      prevHashVariant.current = hashVariant;
      return;
    }

    // Only apply hash if it actually changed (not just a re-render with same hash)
    const hashChanged = prevHashVariant.current !== hashVariant;
    const storedValueChanged = prevStoredValue.current !== storedValue;
    prevHashVariant.current = hashVariant;
    prevStoredValue.current = storedValue;

    if (!hashChanged && !storedValueChanged) {
      return;
    }

    if (
      hashVariant &&
      variantKeys.includes(hashVariant) &&
      hashVariant !== selectedVariantKeyRef.current
    ) {
      // Hash has a variant - use it
      setSelectedVariantKeyState(hashVariant);
      // Save hash variant to localStorage based on configuration
      if (saveHashVariantToLocalStorage === 'on-load' && hashVariant !== storedValue) {
        setStoredValue(hashVariant);
      }
    } else if (
      !hashVariant &&
      !urlHash && // Only fall back to localStorage when hash is truly empty
      storedValue &&
      variantKeys.includes(storedValue) &&
      storedValue !== selectedVariantKeyRef.current
    ) {
      // Hash is empty but localStorage has a variant - use it
      setSelectedVariantKeyState(storedValue);
    }
  }, [
    hashVariant,
    urlHash,
    variantKeys,
    // Note: selectedVariantKey is intentionally NOT in dependencies
    // to avoid effect running when user manually changes variant
    storedValue,
    setStoredValue,
    saveHashVariantToLocalStorage,
  ]);

  // Programmatic setter: doesn't save to localStorage (used for hash-driven changes)
  const setSelectedVariantKeyProgrammatic = React.useCallback(
    (value: React.SetStateAction<string>) => {
      const resolvedValue = typeof value === 'function' ? value(selectedVariantKey) : value;
      if (variantKeys.includes(resolvedValue)) {
        setSelectedVariantKeyState(resolvedValue);
      }
    },
    [selectedVariantKey, variantKeys],
  );

  // User setter: saves to localStorage (used for user-initiated changes like dropdown)
  const setSelectedVariantKeyAsUser = React.useCallback(
    (value: React.SetStateAction<string | null>) => {
      const resolvedValue = typeof value === 'function' ? value(selectedVariantKey) : value;
      // If value is null, select the first variant (default)
      const effectiveValue = resolvedValue ?? variantKeys[0];
      if (effectiveValue && variantKeys.includes(effectiveValue)) {
        // Mark as user-initiated to prevent hash effect from overriding
        isUserInitiatedChange.current = true;
        // Clear hash if it exists and is relevant to this demo
        if (urlHash && mainSlug && isHashRelevantToDemo(urlHash, mainSlug)) {
          setUrlHash(null);
          // Update prevHashVariant to reflect that hash is now null
          prevHashVariant.current = null;
        }
        setSelectedVariantKeyState(effectiveValue);
        setStoredValue(effectiveValue);
      }
    },
    [setStoredValue, selectedVariantKey, variantKeys, urlHash, mainSlug, setUrlHash],
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
      setSelectedVariantKeyProgrammatic(variantKeys[0]);
    }
  }, [selectedVariant, variantKeys, setSelectedVariantKeyProgrammatic]);

  // Function to save variant to localStorage (used for on-interaction mode)
  const saveVariantToLocalStorage = React.useCallback(
    (variant: string) => {
      if (saveHashVariantToLocalStorage === 'on-interaction' && variant !== storedValue) {
        setStoredValue(variant);
      }
    },
    [saveHashVariantToLocalStorage, storedValue, setStoredValue],
  );

  return {
    variantKeys,
    selectedVariantKey,
    selectedVariant,
    selectVariant: setSelectedVariantKeyAsUser,
    selectVariantProgrammatic: setSelectedVariantKeyProgrammatic,
    saveVariantToLocalStorage,
    hashVariant,
  };
}
