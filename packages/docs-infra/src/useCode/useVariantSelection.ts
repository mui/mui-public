import * as React from 'react';
import type { Code, VariantCode } from '../CodeHighlighter/types';
import { usePreference } from '../usePreference';
import { useUrlHashState } from '../useUrlHashState';
import { isHashRelevantToDemo } from './useFileNavigation';
import { toKebabCase } from '../pipeline/loaderUtils/toKebabCase';

function parseVariantFromHash(urlHash: string | null, variantKeys: string[]): string | null {
  if (!urlHash) {
    return null;
  }

  const parts = urlHash.split(':');
  if (parts.length === 3) {
    return variantKeys.find((key) => toKebabCase(key) === parts[1].toLowerCase()) || null;
  }
  if (parts.length === 2) {
    const variant = variantKeys.find((key) => toKebabCase(key) === parts[1].toLowerCase());
    if (variant) {
      return variant;
    }
    if (parts[1].includes('.')) {
      return variantKeys.includes('Default') ? 'Default' : null;
    }
  }
  if (parts.length === 1) {
    return variantKeys.includes('Default') ? 'Default' : null;
  }
  return null;
}

interface UseVariantSelectionProps {
  effectiveCode: Code;
  initialVariant?: string;
  variantType?: string;
  mainSlug?: string;
  saveHashVariantToLocalStorage?: 'on-load' | 'on-interaction' | 'never';
  /** Keeps the last ready variant rendered while the highlighter is rebuilding. */
  deferHighlight?: boolean;
}

export interface UseVariantSelectionResult {
  variantKeys: string[];
  selectedVariantKey: string;
  selectedVariant: VariantCode | null;
  readyVariantKey: string;
  readyVariant: VariantCode | null;
  selectVariant: React.Dispatch<React.SetStateAction<string | null>>;
  selectVariantProgrammatic: React.Dispatch<React.SetStateAction<string>>;
  saveVariantToLocalStorage: (variant: string) => void;
  hashVariant: string | null;
}

function resolveVariantKey(
  hashVariant: string | null,
  storedValue: string | null,
  initialVariant: string | undefined,
  variantKeys: string[],
): string {
  if (hashVariant && variantKeys.includes(hashVariant)) {
    return hashVariant;
  }
  if (storedValue && variantKeys.includes(storedValue)) {
    return storedValue;
  }
  if (initialVariant && variantKeys.includes(initialVariant)) {
    return initialVariant;
  }
  return variantKeys[0] || '';
}

/**
 * Manages variant intent and retains the last ready variant while highlighting
 * catches up. Warm selections render in the same update as the user action.
 */
export function useVariantSelection({
  effectiveCode,
  initialVariant,
  variantType,
  mainSlug,
  saveHashVariantToLocalStorage = 'on-interaction',
  deferHighlight = false,
}: UseVariantSelectionProps): UseVariantSelectionResult {
  const variantKeys = React.useMemo(
    () =>
      Object.keys(effectiveCode).filter((key) => {
        const variant = effectiveCode[key];
        return variant && typeof variant === 'object' && 'source' in variant;
      }),
    [effectiveCode],
  );
  const [urlHash, setUrlHash] = useUrlHashState();
  const hashVariant = React.useMemo(
    () => parseVariantFromHash(urlHash, variantKeys),
    [urlHash, variantKeys],
  );
  const [storedValue, setStoredValue] = usePreference(
    'variant',
    variantType || variantKeys,
    () => null,
  );
  const resolvedValue = resolveVariantKey(hashVariant, storedValue, initialVariant, variantKeys);
  const [selection, setSelection] = React.useState(() => resolvedValue);
  const [lastResolvedValue, setLastResolvedValue] = React.useState(resolvedValue);

  if (lastResolvedValue !== resolvedValue) {
    setLastResolvedValue(resolvedValue);
    setSelection(resolvedValue);
  }

  const selectedVariantKey = variantKeys.includes(selection) ? selection : resolvedValue;
  const selectedVariant = React.useMemo(() => {
    const variant = effectiveCode[selectedVariantKey];
    return variant && typeof variant === 'object' && 'source' in variant ? variant : null;
  }, [effectiveCode, selectedVariantKey]);

  const initialReadyVariantKey = resolveVariantKey(hashVariant, null, initialVariant, variantKeys);
  const [lastReadyVariantKey, setLastReadyVariantKey] = React.useState(() =>
    deferHighlight ? initialReadyVariantKey : selectedVariantKey,
  );
  const nextReadyVariantKey = deferHighlight ? lastReadyVariantKey : selectedVariantKey;
  if (!deferHighlight && lastReadyVariantKey !== selectedVariantKey) {
    setLastReadyVariantKey(selectedVariantKey);
  }
  const readyVariantKey = variantKeys.includes(nextReadyVariantKey)
    ? nextReadyVariantKey
    : selectedVariantKey;
  const readyVariant = React.useMemo(() => {
    const variant = effectiveCode[readyVariantKey];
    return variant && typeof variant === 'object' && 'source' in variant ? variant : null;
  }, [effectiveCode, readyVariantKey]);

  React.useEffect(() => {
    if (saveHashVariantToLocalStorage === 'on-load' && hashVariant && hashVariant !== storedValue) {
      setStoredValue(hashVariant);
    }
  }, [saveHashVariantToLocalStorage, hashVariant, storedValue, setStoredValue]);

  const selectVariant = React.useCallback<React.Dispatch<React.SetStateAction<string | null>>>(
    (value) => {
      const resolved = typeof value === 'function' ? value(selectedVariantKey) : value;
      const next = resolved ?? variantKeys[0];
      if (!next || !variantKeys.includes(next) || next === selectedVariantKey) {
        return;
      }
      if (urlHash && mainSlug && isHashRelevantToDemo(urlHash, mainSlug)) {
        setUrlHash(null);
      }
      setSelection(next);
      setStoredValue(next);
    },
    [selectedVariantKey, variantKeys, urlHash, mainSlug, setUrlHash, setStoredValue],
  );

  const selectVariantProgrammatic = React.useCallback<React.Dispatch<React.SetStateAction<string>>>(
    (value) => {
      const next = typeof value === 'function' ? value(selectedVariantKey) : value;
      if (variantKeys.includes(next) && next !== selectedVariantKey) {
        setSelection(next);
      }
    },
    [selectedVariantKey, variantKeys],
  );

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
    readyVariantKey,
    readyVariant,
    selectVariant,
    selectVariantProgrammatic,
    saveVariantToLocalStorage,
    hashVariant,
  };
}
