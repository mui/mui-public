'use client';

import * as React from 'react';
import { sha256 } from 'js-sha256';
import { useCodeContext } from '../CodeProvider/CodeContext';
import { Code, CodeHighlighterClientProps } from './types';
import { CodeHighlighterContext, CodeHighlighterContextType } from './CodeHighlighterContext';
import { maybeInitialData } from './maybeInitialData';
import { loadFallbackCode } from './loadFallbackCode';
import { hasAllVariants } from './hasAllVariants';
import { loadVariant } from './loadVariant';
import { CodeHighlighterFallbackContext } from './CodeHighlighterFallbackContext';
import { Selection, useControlledCode } from '../CodeControllerContext';
import { codeToFallbackProps } from './codeToFallbackProps';
import { applyTransform, getTransformKeys } from './applyTransform';
import { useHighlighted } from './useHighlighted';
import { useTransformer } from './useTransformer';

const DEBUG = false; // Set to true for debugging purposes

function useInitialData({
  variants,
  variantName,
  code,
  setCode,
  fileName,
  url,
  highlightAt,
  fallbackUsesExtraFiles,
  fallbackUsesAllVariants,
  isControlled,
}: {
  variants: string[];
  variantName: string;
  code?: Code;
  setCode: React.Dispatch<React.SetStateAction<Code | undefined>>;
  fileName?: string;
  url: string;
  highlightAt?: 'init' | 'hydration' | 'idle';
  fallbackUsesExtraFiles?: boolean;
  fallbackUsesAllVariants?: boolean;
  isControlled: boolean;
}) {
  const { parseSource, loadCodeMeta, loadVariantMeta, loadSource } = useCodeContext();

  const { initialData, reason } = React.useMemo(
    () =>
      maybeInitialData(
        variants,
        variantName,
        code,
        fileName,
        highlightAt === 'init',
        fallbackUsesExtraFiles,
        fallbackUsesAllVariants,
      ),
    [
      variants,
      variantName,
      code,
      fileName,
      highlightAt,
      fallbackUsesExtraFiles,
      fallbackUsesAllVariants,
    ],
  );

  // TODO: fallbackInitialRenderOnly option? this would mean we can't fetch fallback data on the client side
  // Load initial data if not provided
  React.useEffect(() => {
    if (initialData || isControlled) {
      return;
    }

    // TODO: abort controller

    (async () => {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.log('Loading initial data for CodeHighlighterClient: ', reason);
      }

      const loaded = await loadFallbackCode(
        url,
        variantName,
        code,
        highlightAt === 'init',
        fallbackUsesExtraFiles,
        fallbackUsesAllVariants,
        parseSource,
        loadSource,
        loadVariantMeta,
        loadCodeMeta,
      ).catch((error) => ({ error }));

      if ('error' in loaded) {
        // TODO: handle error
      } else {
        setCode(loaded.code);
      }
    })();
  }, [
    initialData,
    reason,
    isControlled,
    variantName,
    code,
    setCode,
    highlightAt,
    url,
    parseSource,
    loadSource,
    loadVariantMeta,
    loadCodeMeta,
    fallbackUsesExtraFiles,
    fallbackUsesAllVariants,
  ]);
}

function useAllVariants({
  readyForContent,
  variants,
  isControlled,
  url,
  code,
  setCode,
}: {
  readyForContent: boolean;
  variants: string[];
  isControlled: boolean;
  url: string;
  code?: Code;
  setCode: React.Dispatch<React.SetStateAction<Code | undefined>>;
}) {
  const { loadCodeMeta, loadVariantMeta, loadSource } = useCodeContext();

  React.useEffect(() => {
    if (readyForContent || isControlled) {
      return;
    }

    // TODO: abort controller

    (async () => {
      let loadedCode = code;
      if (!loadedCode) {
        if (!loadCodeMeta) {
          throw new Error('"loadCodeMeta" function is required when no code is provided');
        }

        loadedCode = await loadCodeMeta(url);
      }

      // Load variant data without parsing or transforming
      const result = await Promise.all(
        variants.map((name) =>
          loadVariant(
            url,
            name,
            loadedCode[name],
            undefined, // parseSource - skip parsing
            loadSource,
            loadVariantMeta,
            undefined, // sourceTransformers - skip transforming
            { disableParsing: true, disableTransforms: true },
          )
            .then((variant) => ({ name, variant }))
            .catch((error) => ({ error })),
        ),
      );

      const resultCode: Code = {};
      const errors: Error[] = [];
      for (const item of result) {
        if ('error' in item) {
          errors.push(item.error);
        } else {
          resultCode[item.name] = item.variant.code;
        }
      }

      if (errors.length > 0) {
        // TODO: handle error
      } else {
        setCode(resultCode);
      }
    })();
  }, [
    readyForContent,
    isControlled,
    variants,
    url,
    code,
    setCode,
    loadSource,
    loadVariantMeta,
    loadCodeMeta,
  ]);

  return { readyForContent };
}

/**
 * Hook to provide transform utilities for the current variant
 */
function useTransforms({
  activeCode,
  readyForContent,
  variantName,
  transformKey,
  transformCache,
  isControlled,
}: {
  activeCode?: Code;
  readyForContent: boolean;
  variantName: string;
  transformKey?: string;
  transformCache?: React.MutableRefObject<Map<string, Record<string, string>>>;
  isControlled: boolean;
}) {
  // Get available transforms for the current variant
  const availableTransforms = React.useMemo(() => {
    if (!readyForContent || !activeCode || isControlled) {
      // Don't show transforms for controlled code
      return [];
    }

    const codeVariant = activeCode[variantName];
    if (!codeVariant || typeof codeVariant === 'string') {
      return [];
    }

    if (!codeVariant.transforms) {
      return [];
    }

    return getTransformKeys(codeVariant.transforms);
  }, [readyForContent, activeCode, variantName, isControlled]);

  // Apply transform to get the current transformed code
  const transformedCode = React.useMemo(() => {
    if (!readyForContent || !activeCode || !transformKey || isControlled) {
      // Don't transform controlled code
      return undefined;
    }

    const codeVariant = activeCode[variantName];
    if (!codeVariant || typeof codeVariant === 'string') {
      return undefined;
    }

    if (!codeVariant.transforms) {
      return undefined;
    }

    // Check if we have cached transformed sources
    if (transformCache && typeof codeVariant.source === 'string') {
      const sourceHash = `${codeVariant.fileName}:${sha256(
        codeVariant.source + JSON.stringify(codeVariant.transforms),
      )}`;
      const cachedTransforms = transformCache.current.get(sourceHash);
      if (cachedTransforms && cachedTransforms[transformKey]) {
        return cachedTransforms[transformKey];
      }
    }

    // Fall back to real-time transformation
    try {
      return applyTransform(codeVariant.source || '', codeVariant.transforms, transformKey);
    } catch (error) {
      console.error(
        `Failed to apply transform "${transformKey}" to variant "${variantName}":`,
        error,
      );
      return undefined;
    }
  }, [readyForContent, activeCode, variantName, transformKey, transformCache, isControlled]);

  return {
    availableTransforms,
    transformedCode,
  };
}

export function CodeHighlighterClient(props: CodeHighlighterClientProps) {
  const {
    controlledCode,
    controlledSelection,
    controlledSetCode,
    controlledSetSelection,
    controlledComponents,
  } = useControlledCode();

  const isControlled = Boolean(props.code || controlledCode);

  // TODO: props.code is for controlled components, props.precompute is for precomputed code
  // props.code should only be highlighted, but no additional fetching should be done
  // this is the case with live demos where the code can be edited by the user
  // then maybe props.code shouldn't allow highlighted code, only strings?
  // this is a code highlighter afterall, why would they want to control the highlighting aspect?

  // TODO: should we empty this state if controlled?
  const [code, setCode] = React.useState(
    typeof props.precompute === 'object' ? props.precompute : undefined,
  );

  // TODO: if using props.variant, then the variant is controlled and we can't use our own state
  // does props.variant make any sense instead of controlledSelection?.variant?
  const [selection, setSelection] = React.useState<Selection>({
    variant: props.initialVariant || props.defaultVariant || 'Default',
  });

  const variantName = controlledSelection?.variant || props.variant || selection.variant;
  const activeCode = controlledCode || props.code || code;
  const initialFilename =
    typeof activeCode?.[variantName] === 'object' &&
    (activeCode?.[variantName]?.filesOrder
      ? activeCode[variantName].filesOrder[0]
      : activeCode?.[variantName]?.fileName);
  const fileName = controlledSelection?.fileName || props.fileName || initialFilename || 'index.js';

  const variants = props.variants || Object.keys(props.components || activeCode || {});
  const { url, highlightAt, fallbackUsesExtraFiles, fallbackUsesAllVariants } = props;

  useInitialData({
    variants,
    variantName,
    code,
    setCode,
    fileName,
    url,
    highlightAt,
    fallbackUsesExtraFiles,
    fallbackUsesAllVariants,
    isControlled,
  });

  const readyForContent = React.useMemo(() => {
    if (!activeCode) {
      return false;
    }

    return hasAllVariants(variants, activeCode);
  }, [activeCode, variants]);

  useAllVariants({
    readyForContent,
    variants,
    isControlled,
    url,
    code,
    setCode,
  });

  // When the content uses setCode, it needs to first setOverlaidCode, then setCode
  // this ensures that the text is updated before the component controlled by the controller is
  // we also need a cache for the overlaid code to avoid rehighlighting unchanged code
  const { overlaidCode, contextSetCode } = useHighlighted({
    highlightAt,
    isControlled,
    activeCode,
    readyForContent,
    variants,
    setCode,
    controlledSetCode,
  });

  // Transform all parsed code with per-file caching
  useTransformer({
    code, // only transform internally loaded code
    readyForContent,
    variants,
    setCode,
  });

  // Provide transform utilities for applying specific transforms to code variants
  const { availableTransforms, transformedCode: currentTransformedCode } = useTransforms({
    activeCode: overlaidCode || activeCode,
    readyForContent,
    variantName,
    transformKey: controlledSelection?.transformKey || selection.transformKey,
    transformCache: undefined, // No longer using cache
    isControlled: Boolean(overlaidCode || controlledCode),
  });

  // TODO: there seems to be some kind of infinite loop in this component

  const fallbackContext = React.useMemo(
    () =>
      codeToFallbackProps(
        variantName,
        activeCode,
        fileName,
        props.fallbackUsesExtraFiles,
        props.fallbackUsesAllVariants,
      ),
    [
      variantName,
      activeCode,
      fileName,
      props.fallbackUsesExtraFiles,
      props.fallbackUsesAllVariants,
    ],
  );

  const context: CodeHighlighterContextType = React.useMemo(
    () => ({
      code: overlaidCode || controlledCode || code,
      setCode: controlledSetCode ? contextSetCode : undefined,
      selection: controlledSelection || selection,
      setSelection: controlledSetSelection || setSelection,
      components: controlledComponents || props.components,
      availableTransforms,
      transformedCode: currentTransformedCode,
    }),
    [
      overlaidCode,
      controlledCode,
      code,
      controlledSetCode,
      contextSetCode,
      selection,
      controlledSelection,
      controlledSetSelection,
      controlledComponents,
      props.components,
      availableTransforms,
      currentTransformedCode,
    ],
  );

  if (!props.variants && !props.components && !activeCode) {
    throw new Error(
      'CodeHighlighterClient requires either `variants`, `components`, or `code` to be provided.',
    );
  }

  const fallback = props.fallback;
  if (fallback && !props.skipFallback && !readyForContent) {
    return (
      <CodeHighlighterFallbackContext.Provider value={fallbackContext}>
        {fallback}
      </CodeHighlighterFallbackContext.Provider>
    );
  }

  return (
    <CodeHighlighterContext.Provider value={context}>
      {props.children}
    </CodeHighlighterContext.Provider>
  );
}
