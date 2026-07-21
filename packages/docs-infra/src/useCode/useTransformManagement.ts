import * as React from 'react';
import type { Code, VariantCode } from '../CodeHighlighter/types';
import { decodeHastSource } from '../pipeline/loadIsomorphicCodeVariant/decodeHastSource';
import { frameFallbackFromSpans } from '../pipeline/hastUtils';
import { getApplicableTransforms, getAvailableTransforms } from './useCodeUtils';
import type { CreateTransformedFiles, TransformRuntimeDeps } from './TransformEngine';
import {
  peekTransformEngine,
  preloadTransformEngine,
  resetTransformEngineCache,
} from './transformEngineCache';
import type { CodeHighlighterContextType } from '../CodeHighlighter/CodeHighlighterContext';
import { useCodeContext } from '../CodeProvider/CodeContext';
import { usePreference } from '../usePreference';

const transformRuntimeDeps: TransformRuntimeDeps = {
  decode: decodeHastSource,
  frameFallbackFromSpans,
};

export { preloadTransformEngine, resetTransformEngineCache };

interface UseTransformManagementProps {
  context?: CodeHighlighterContextType;
  effectiveCode: Code;
  selectedVariantKey: string;
  selectedVariant: VariantCode | null;
  initialTransform?: string;
  selectedTransform?: string | null;
  onSelectedTransformChange?: (transform: string | null) => void;
}

export interface UseTransformManagementResult {
  availableTransforms: string[];
  selectedTransform: string | null;
  transformedFiles: ReturnType<CreateTransformedFiles>;
  selectTransform: (transformName: string | null) => void;
}

type AppliedTransform = {
  variant: VariantCode | null;
  transform: string | null;
  result: ReturnType<CreateTransformedFiles>;
};

/**
 * Applies transforms immediately when the engine and highlighted source are
 * ready, retaining the previous result only while either dependency is cold.
 */
export function useTransformManagement({
  context,
  effectiveCode,
  selectedVariantKey,
  selectedVariant,
  initialTransform,
  selectedTransform: controlledTransform,
  onSelectedTransformChange,
}: UseTransformManagementProps): UseTransformManagementResult {
  const availableTransforms = React.useMemo(() => {
    if (context?.availableTransforms?.length) {
      return context.availableTransforms;
    }
    return getAvailableTransforms(effectiveCode, selectedVariantKey);
  }, [context?.availableTransforms, effectiveCode, selectedVariantKey]);

  const contextAvailableTransforms = context?.availableTransforms;
  const applicableFromCode = React.useMemo(
    () => getApplicableTransforms(effectiveCode, selectedVariantKey),
    [effectiveCode, selectedVariantKey],
  );
  const applicableTransforms = React.useMemo(() => {
    if (applicableFromCode.length === 0 && contextAvailableTransforms?.length) {
      return contextAvailableTransforms;
    }
    return applicableFromCode;
  }, [applicableFromCode, contextAvailableTransforms]);

  const [storedValue, setStoredValue] = usePreference(
    'transform',
    applicableTransforms.length === 1 ? applicableTransforms[0] : applicableTransforms,
    () => null,
  );
  const resolveTransform = React.useCallback(
    (value: string | null): string | null => {
      if (value !== null) {
        return value !== '' && applicableTransforms.includes(value) ? value : null;
      }
      return initialTransform && applicableTransforms.includes(initialTransform)
        ? initialTransform
        : null;
    },
    [applicableTransforms, initialTransform],
  );
  let resolvedTransform: string | null;
  if (controlledTransform !== undefined) {
    resolvedTransform =
      controlledTransform && applicableTransforms.includes(controlledTransform)
        ? controlledTransform
        : null;
  } else {
    resolvedTransform = resolveTransform(storedValue);
  }
  const [uncontrolledTransform, setUncontrolledTransform] = React.useState(resolvedTransform);
  const [lastResolvedTransform, setLastResolvedTransform] = React.useState(resolvedTransform);
  if (controlledTransform === undefined && lastResolvedTransform !== resolvedTransform) {
    setLastResolvedTransform(resolvedTransform);
    setUncontrolledTransform(resolvedTransform);
  }
  const selectedTransform =
    controlledTransform === undefined ? uncontrolledTransform : resolvedTransform;

  const { transformEngineLoader } = useCodeContext();
  const [transformEngine, setTransformEngine] = React.useState<CreateTransformedFiles | null>(
    () => peekTransformEngine() ?? null,
  );

  React.useEffect(() => {
    if (transformEngine || applicableTransforms.length === 0) {
      return undefined;
    }
    const warm = peekTransformEngine();
    if (warm) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- adopts a cache warmed after render
      setTransformEngine(() => warm);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      await preloadTransformEngine(transformEngineLoader);
      if (!cancelled) {
        const loaded = peekTransformEngine();
        if (loaded) {
          setTransformEngine(() => loaded);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transformEngine, applicableTransforms.length, transformEngineLoader]);

  const transformApplicable =
    selectedTransform === null || applicableFromCode.includes(selectedTransform);
  const canApply =
    !context?.deferHighlight &&
    (selectedTransform === null || transformEngine !== null) &&
    transformApplicable;
  const nextApplied = React.useMemo<AppliedTransform | null>(() => {
    if (!canApply) {
      return null;
    }
    return {
      variant: selectedVariant,
      transform: selectedTransform,
      result:
        selectedTransform && transformEngine
          ? transformEngine(
              selectedVariant,
              selectedTransform,
              transformRuntimeDeps,
              context?.fallbacks,
            )
          : undefined,
    };
  }, [canApply, selectedVariant, selectedTransform, transformEngine, context?.fallbacks]);
  const [lastApplied, setLastApplied] = React.useState<AppliedTransform | null>(nextApplied);
  if (
    nextApplied &&
    (lastApplied?.variant !== nextApplied.variant ||
      lastApplied.transform !== nextApplied.transform ||
      lastApplied.result !== nextApplied.result)
  ) {
    setLastApplied(nextApplied);
  }
  const transformedFiles = transformApplicable ? (nextApplied ?? lastApplied)?.result : undefined;

  const selectTransform = React.useCallback(
    (value: string | null) => {
      const next = value === null || applicableTransforms.includes(value) ? value : null;
      if (next === selectedTransform) {
        return;
      }
      if (controlledTransform !== undefined) {
        onSelectedTransformChange?.(next);
      } else {
        setUncontrolledTransform(next);
        setStoredValue(next ?? '');
      }
    },
    [
      applicableTransforms,
      selectedTransform,
      controlledTransform,
      onSelectedTransformChange,
      setStoredValue,
    ],
  );

  return {
    availableTransforms,
    selectedTransform,
    transformedFiles,
    selectTransform,
  };
}
