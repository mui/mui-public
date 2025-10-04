import * as React from 'react';
import type { Code, VariantCode } from '../CodeHighlighter/types';
import { usePreference } from '../usePreference';

// Debug flag - add ?debugFileNav to URL to enable detailed logging
const DEBUG_VARIANT_SELECTION =
  typeof window !== 'undefined' && window.location.search.includes('debugFileNav');

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
    let selectedKey = '';
    let selectionReason = '';

    // First priority: use stored value if it exists and is valid
    if (storedValue && variantKeys.includes(storedValue)) {
      selectedKey = storedValue;
      selectionReason = 'localStorage';
    }
    // Second priority: use initial variant if provided and valid
    else if (initialVariant && variantKeys.includes(initialVariant)) {
      selectedKey = initialVariant;
      selectionReason = 'initialVariant prop';
    }
    // Final fallback: use first available variant
    else {
      selectedKey = variantKeys[0] || '';
      selectionReason = 'first variant (fallback)';
    }

    if (DEBUG_VARIANT_SELECTION) {
      // eslint-disable-next-line no-console
      console.log('[useVariantSelection] 🎬 Initial variant selection:', {
        selected: selectedKey,
        reason: selectionReason,
        storedValue,
        initialVariant,
        availableVariants: variantKeys,
      });
    }

    return selectedKey;
  });

  // Sync with localStorage changes (but don't override programmatic changes)
  // Only sync when storedValue changes, not when selectedVariantKey changes
  const prevStoredValue = React.useRef(storedValue);
  React.useEffect(() => {
    if (storedValue !== prevStoredValue.current) {
      if (DEBUG_VARIANT_SELECTION) {
        // eslint-disable-next-line no-console
        console.log('[useVariantSelection] 💾 localStorage value changed:', {
          from: prevStoredValue.current,
          to: storedValue,
          currentSelection: selectedVariantKey,
        });
      }
      prevStoredValue.current = storedValue;
      if (storedValue && variantKeys.includes(storedValue) && storedValue !== selectedVariantKey) {
        if (DEBUG_VARIANT_SELECTION) {
          // eslint-disable-next-line no-console
          console.log('[useVariantSelection] 🔄 Syncing to localStorage value:', storedValue);
        }
        setSelectedVariantKeyState(storedValue);
      } else if (DEBUG_VARIANT_SELECTION) {
        // eslint-disable-next-line no-console
        console.log(
          '[useVariantSelection] ⏭️  Not syncing localStorage value (invalid or already selected)',
        );
      }
    }
  }, [storedValue, variantKeys, selectedVariantKey]);

  const setSelectedVariantKeyProgrammatic = React.useCallback(
    (value: React.SetStateAction<string>) => {
      const resolvedValue = typeof value === 'function' ? value(selectedVariantKey) : value;
      if (variantKeys.includes(resolvedValue)) {
        if (DEBUG_VARIANT_SELECTION) {
          // eslint-disable-next-line no-console
          console.log('[useVariantSelection] 🤖 Programmatic variant change (no localStorage):', {
            from: selectedVariantKey,
            to: resolvedValue,
          });
        }
        // Only update React state, not localStorage
        // This prevents conflicts with hash-driven navigation
        setSelectedVariantKeyState(resolvedValue);
      } else if (DEBUG_VARIANT_SELECTION) {
        // eslint-disable-next-line no-console
        console.log('[useVariantSelection] ❌ Invalid programmatic variant (not in keys):', {
          attempted: resolvedValue,
          available: variantKeys,
        });
      }
    },
    [selectedVariantKey, variantKeys],
  );

  const setSelectedVariantKeyAsUser = React.useCallback(
    (value: React.SetStateAction<string>) => {
      const resolvedValue = typeof value === 'function' ? value(selectedVariantKey) : value;
      if (variantKeys.includes(resolvedValue)) {
        if (DEBUG_VARIANT_SELECTION) {
          // eslint-disable-next-line no-console
          console.log('[useVariantSelection] 👤 User variant change (with localStorage):', {
            from: selectedVariantKey,
            to: resolvedValue,
          });
        }
        setSelectedVariantKeyState(resolvedValue);
        setStoredValue(resolvedValue);
      } else if (DEBUG_VARIANT_SELECTION) {
        // eslint-disable-next-line no-console
        console.log('[useVariantSelection] ❌ Invalid user variant (not in keys):', {
          attempted: resolvedValue,
          available: variantKeys,
        });
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
      if (DEBUG_VARIANT_SELECTION) {
        // eslint-disable-next-line no-console
        console.log(
          '[useVariantSelection] ⚠️  Fallback: selected variant not found, using first variant:',
          {
            selectedKey: selectedVariantKey,
            fallbackTo: variantKeys[0],
            availableVariants: variantKeys,
          },
        );
      }
      // Don't mark this as a user selection - it's just a fallback
      // Use programmatic setter to avoid localStorage save
      setSelectedVariantKeyProgrammatic(variantKeys[0]);
    }
  }, [selectedVariant, variantKeys, setSelectedVariantKeyProgrammatic, selectedVariantKey]);

  return {
    variantKeys,
    selectedVariantKey,
    selectedVariant,
    selectVariant: setSelectedVariantKeyAsUser,
    selectVariantProgrammatic: setSelectedVariantKeyProgrammatic,
  };
}
