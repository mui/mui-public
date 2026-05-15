import * as React from 'react';
import type { Code, VariantCode } from '../CodeHighlighter/types';
import { getAvailableTransforms, createTransformedFiles } from './useCodeUtils';
import { type CodeHighlighterContextType } from '../CodeHighlighter/CodeHighlighterContext';
import { usePreference } from '../usePreference';

interface UseTransformManagementProps {
  context?: CodeHighlighterContextType;
  effectiveCode: Code;
  selectedVariantKey: string;
  selectedVariant: VariantCode | null;
  initialTransform?: string;
}

export interface UseTransformManagementResult {
  availableTransforms: string[];
  selectedTransform: string | null;
  transformedFiles: ReturnType<typeof createTransformedFiles>;
  selectTransform: (transformName: string | null) => void;
}

/**
 * Hook for managing code transforms and their application
 * Uses the useLocalStorage hook for local storage persistence of transform preferences
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

  // Use localStorage hook for transform persistence. localStorage is the
  // cross-demo broadcast channel, but the *current* demo tracks its
  // selection in local React state so a user click applies immediately,
  // before other demos sharing the same storage key re-render.
  const [storedValue, setStoredValue] = usePreference(
    'transform',
    availableTransforms.length === 1 ? availableTransforms[0] : availableTransforms,
    () => {
      // Don't use initialTransform as the fallback - localStorage should always take precedence
      // We'll handle the initial transform separately below
      return null;
    },
  );

  // Defer the storage-driven value so peer demos that receive the
  // broadcast can schedule a low-priority re-render instead of competing
  // for the synchronous commit triggered by `useSyncExternalStore`. The
  // synchronous render that fires for every subscriber sees the *old*
  // deferred value, so nothing downstream of `selectedTransform`
  // recomputes; the actual transform application is committed later as
  // a low-priority transition (one extra commit per demo).
  const deferredStoredValue = React.useDeferredValue(storedValue);

  // Resolve a stored/initial value into a valid transform name (or null).
  const resolveTransform = React.useCallback(
    (stored: string | null): string | null => {
      if (stored !== null) {
        if (stored === '') {
          return null;
        }
        if (!availableTransforms.includes(stored)) {
          return null;
        }
        return stored;
      }
      if (initialTransform && availableTransforms.includes(initialTransform)) {
        return initialTransform;
      }
      return null;
    },
    [availableTransforms, initialTransform],
  );

  // Local mirror of the resolved transform. This is the source of truth
  // for *this* demo so user-initiated changes are reflected synchronously
  // in the same render that calls `selectTransform`, before the
  // localStorage broadcast reaches other demos.
  const [localSelectedTransform, setLocalSelectedTransform] = React.useState<string | null>(() =>
    resolveTransform(storedValue),
  );

  // Sync from deferredStoredValue → local when the change originated
  // elsewhere (another demo, another tab, or a change in
  // availableTransforms / initialTransform that re-resolves the value).
  // The update is wrapped in `startTransition` so the peer-demo
  // re-render that applies the new transform is interruptible by
  // higher-priority work (e.g., the user clicking another control).
  const prevStoredValueRef = React.useRef(deferredStoredValue);
  const prevResolvedRef = React.useRef(localSelectedTransform);
  React.useEffect(() => {
    const resolved = resolveTransform(deferredStoredValue);
    const storedChanged = prevStoredValueRef.current !== deferredStoredValue;
    const resolvedChanged = prevResolvedRef.current !== resolved;
    prevStoredValueRef.current = deferredStoredValue;
    prevResolvedRef.current = resolved;
    if ((storedChanged || resolvedChanged) && resolved !== localSelectedTransform) {
      React.startTransition(() => {
        setLocalSelectedTransform(resolved);
      });
    }
  }, [deferredStoredValue, resolveTransform, localSelectedTransform]);

  const selectedTransform = localSelectedTransform;

  const setSelectedTransformAsUser = React.useCallback(
    (value: string | null) => {
      // Apply to the current demo first so its render is not blocked on
      // the localStorage round-trip; then broadcast to peer demos.
      setLocalSelectedTransform(value);
      const valueToStore = value === null ? '' : value;
      setStoredValue(valueToStore);
    },
    [setStoredValue],
  );

  // Memoize all transformed files based on selectedTransform
  const transformedFiles = React.useMemo(() => {
    return createTransformedFiles(selectedVariant, selectedTransform);
  }, [selectedVariant, selectedTransform]);

  return {
    availableTransforms,
    selectedTransform,
    transformedFiles,
    selectTransform: setSelectedTransformAsUser,
  };
}
