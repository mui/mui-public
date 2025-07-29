'use client';

import * as React from 'react';
import { useCodeContext } from '../CodeProvider/CodeContext';
import { Code, CodeHighlighterClientProps, ControlledCode } from './types';
import { CodeHighlighterContext, CodeHighlighterContextType } from './CodeHighlighterContext';
import { maybeInitialData } from './maybeInitialData';
import { loadFallbackCode } from './loadFallbackCode';
import { hasAllVariants } from './hasAllVariants';
import { loadVariant } from './loadVariant';
import { CodeHighlighterFallbackContext } from './CodeHighlighterFallbackContext';
import { Selection, useControlledCode } from '../CodeControllerContext';
import { codeToFallbackProps } from './codeToFallbackProps';
import { parseCode } from './parseCode';
import { applyTransforms, getAvailableTransforms } from './transformCode';
import { parseControlledCode } from './parseControlledCode';

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
  url?: string;
  highlightAt?: 'init' | 'hydration' | 'idle';
  fallbackUsesExtraFiles?: boolean;
  fallbackUsesAllVariants?: boolean;
  isControlled: boolean;
}) {
  const { sourceParser, loadCodeMeta, loadVariantMeta, loadSource } = useCodeContext();

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

    if (!url) {
      // TODO: handle error - URL is required for loading fallback data
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
        sourceParser,
        loadSource,
        loadVariantMeta,
        loadCodeMeta,
        fileName,
        variants,
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
    sourceParser,
    loadSource,
    loadVariantMeta,
    loadCodeMeta,
    fallbackUsesExtraFiles,
    fallbackUsesAllVariants,
    fileName,
    variants,
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
  url?: string;
  code?: Code;
  setCode: React.Dispatch<React.SetStateAction<Code | undefined>>;
}) {
  const { loadCodeMeta, loadVariantMeta, loadSource } = useCodeContext();

  React.useEffect(() => {
    if (readyForContent || isControlled) {
      return;
    }

    if (!url) {
      // URL is required for loading variants
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
            undefined, // sourceParser - skip parsing
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

function useCodeParsing({ code, readyForContent }: { code?: Code; readyForContent: boolean }) {
  const { parseSource } = useCodeContext();

  // Parse the internal code state when ready
  const parsedCode = React.useMemo(() => {
    if (!code || !readyForContent || !parseSource) {
      return undefined;
    }

    return parseCode(code, parseSource);
  }, [code, readyForContent, parseSource]);

  return { parsedCode };
}

function useCodeTransforms({
  parsedCode,
  variantName,
}: {
  parsedCode?: Code;
  variantName: string;
}) {
  const { sourceParser } = useCodeContext();
  const [transformedCode, setTransformedCode] = React.useState<Code | undefined>(undefined);

  // Get available transforms from the current variant (separate memo for efficiency)
  const availableTransforms = React.useMemo(() => {
    return getAvailableTransforms(parsedCode, variantName);
  }, [parsedCode, variantName]);

  // Effect to compute transformations for all variants
  React.useEffect(() => {
    if (!parsedCode || !sourceParser) {
      setTransformedCode(parsedCode);
      return;
    }

    // Process transformations for all variants
    (async () => {
      try {
        const parseSource = await sourceParser;
        const enhanced = await applyTransforms(parsedCode, parseSource);
        setTransformedCode(enhanced);
      } catch (error) {
        console.error('Failed to process transforms:', error);
        setTransformedCode(parsedCode);
      }
    })();
  }, [parsedCode, sourceParser]);

  return { transformedCode, availableTransforms };
}

function useControlledCodeParsing({ controlledCode }: { controlledCode?: ControlledCode }) {
  const { parseSource } = useCodeContext();

  // Parse the controlled code separately (no need to check readyForContent)
  const parsedControlledCode = React.useMemo(() => {
    if (!controlledCode || !parseSource) {
      return undefined;
    }

    return parseControlledCode(controlledCode, parseSource);
  }, [controlledCode, parseSource]);

  return { parsedControlledCode };
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
  let initialFilename: string | undefined;
  if (typeof activeCode?.[variantName] === 'object') {
    const variant = activeCode[variantName];
    initialFilename = variant?.filesOrder ? variant.filesOrder[0] : variant?.fileName;
  }
  const fileName = controlledSelection?.fileName || props.fileName || initialFilename;

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
    if (!code) {
      return false;
    }

    return hasAllVariants(variants, code);
  }, [code, variants]);

  // Separate check for activeCode to determine when to show fallback
  const activeCodeReady = React.useMemo(() => {
    if (!activeCode) {
      return false;
    }

    // Controlled code is always ready since it comes from editing already-ready code
    if (controlledCode) {
      return true;
    }

    // For regular code, use the existing hasAllVariants function
    const regularCode = props.code || code;
    return regularCode ? hasAllVariants(variants, regularCode) : false;
  }, [activeCode, controlledCode, variants, props.code, code]);

  useAllVariants({
    readyForContent,
    variants,
    isControlled,
    url,
    code,
    setCode,
  });

  const { parsedCode } = useCodeParsing({
    code: props.code || code,
    readyForContent: readyForContent || Boolean(props.code),
  });

  const { transformedCode, availableTransforms } = useCodeTransforms({
    parsedCode,
    variantName,
  });

  const { parsedControlledCode } = useControlledCodeParsing({
    controlledCode,
  });

  // Determine the final overlaid code (controlled takes precedence)
  const overlaidCode = parsedControlledCode || transformedCode;

  // For fallback context, use the processed code or fall back to non-controlled code
  const codeForFallback = overlaidCode || (controlledCode ? undefined : props.code || code);

  const fallbackContext = React.useMemo(
    () =>
      codeToFallbackProps(
        variantName,
        codeForFallback,
        fileName,
        props.fallbackUsesExtraFiles,
        props.fallbackUsesAllVariants,
      ),
    [
      variantName,
      codeForFallback,
      fileName,
      props.fallbackUsesExtraFiles,
      props.fallbackUsesAllVariants,
    ],
  );

  const context: CodeHighlighterContextType = React.useMemo(
    () => ({
      code: overlaidCode || transformedCode, // Use processed/transformed code
      setCode: controlledSetCode,
      selection: controlledSelection || selection,
      setSelection: controlledSetSelection || setSelection,
      components: controlledComponents || props.components,
      availableTransforms: isControlled ? [] : availableTransforms,
      url: props.url,
    }),
    [
      overlaidCode,
      transformedCode,
      controlledSetCode,
      selection,
      controlledSelection,
      controlledSetSelection,
      controlledComponents,
      props.components,
      isControlled,
      availableTransforms,
      props.url,
    ],
  );

  if (!props.variants && !props.components && !activeCode) {
    throw new Error(
      'CodeHighlighterClient requires either `variants`, `components`, or `code` to be provided.',
    );
  }

  const fallback = props.fallback;
  if (fallback && !props.skipFallback && !activeCodeReady) {
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
