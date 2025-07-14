'use client';

import * as React from 'react';
import { useCodeContext } from '../CodeProvider/CodeContext';
import { Code, CodeHighlighterClientProps } from './types';
import { CodeHighlighterContext, CodeHighlighterContextType } from './CodeHighlighterContext';
import { maybeInitialData } from './maybeInitialData';
import { loadFallbackVariant } from './loadFallbackVariant';
import { hasAllVariants } from './hasAllVariants';
import { loadVariant } from './loadVariant';
import { CodeHighlighterFallbackContext } from './CodeHighlighterFallbackContext';
import { Selection, useControlledCode } from '../CodeControllerContext';
import { useOnHydrate } from '../useOnHydrate';
import { useOnIdle } from '../useOnIdle';
import { codeToFallbackProps } from './codeToFallbackProps';

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
  const { parseSource, loadVariantCode, loadSource } = useCodeContext();

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

      const loaded = await loadFallbackVariant(
        variantName,
        highlightAt === 'init',
        code,
        code?.[variantName],
        url,
        parseSource,
        loadSource,
        loadVariantCode,
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
    loadVariantCode,
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
  const { parseSource, loadVariantCode, loadSource } = useCodeContext();

  React.useEffect(() => {
    if (readyForContent || isControlled) {
      return;
    }

    // TODO: abort controller

    (async () => {
      // TODO: avoid highlighting at this stage
      const result = await Promise.all(
        variants.map((name) =>
          loadVariant(name, url, code?.[name], parseSource, loadSource, loadVariantCode).catch(
            (error) => ({ error }),
          ),
        ),
      );

      const resultCode: Code = {};
      const errors: Error[] = [];
      for (const variant of result) {
        if ('error' in variant) {
          errors.push(variant.error);
        } else {
          resultCode[variant.variant] = variant.code;
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
    parseSource,
    loadSource,
    loadVariantCode,
  ]);

  return { readyForContent };
}

function useHighlighter({
  highlightAt = 'hydration',
  isControlled,
  activeCode,
  readyForContent,
  variants,
  setCode,
}: {
  readyForContent: boolean;
  highlightAt?: 'init' | 'hydration' | 'idle';
  isControlled: boolean;
  activeCode?: Code;
  variants: string[];
  setCode: React.Dispatch<React.SetStateAction<Code | undefined>>;
}) {
  const { parseSource } = useCodeContext();
  const isHydrated = useOnHydrate();
  const isIdle = useOnIdle();
  const [overlaidCode, setOverlaidCode] = React.useState<Code | undefined>();

  // Ensure all the code is highlighted
  React.useEffect(() => {
    if (!readyForContent) {
      return;
    }

    if (highlightAt === 'hydration' && !isHydrated) {
      return;
    }

    if (highlightAt === 'idle' && !isIdle) {
      return;
    }

    // TODO: abort controller

    (async () => {
      const result = await Promise.all(
        variants.map(async (name) => {
          const codeVariant = activeCode?.[name];
          if (typeof codeVariant?.source === 'string') {
            if (!parseSource) {
              return { error: new Error('Source is not a string or parseSource is not provided') };
            }

            return parseSource(codeVariant?.source, codeVariant.fileName)
              .then((parsedSource) => ({
                variant: name,
                code: { ...codeVariant, source: parsedSource },
              }))
              .catch((error) => ({ error }));
          }

          // TODO: handle extraFiles

          return { variant: name, code: codeVariant };
        }),
      );

      const resultCode: Code = {};
      const errors: Error[] = [];
      for (const variant of result) {
        if ('error' in variant) {
          errors.push(variant.error);
        } else if (variant.code) {
          resultCode[variant.variant] = variant.code;
        }
      }

      if (errors.length > 0) {
        // TODO: handle error
      } else if (isControlled) {
        setOverlaidCode(resultCode);
      } else {
        setCode(resultCode);
        setOverlaidCode(undefined);
      }
    })();
  }, [
    isControlled,
    activeCode,
    isHydrated,
    isIdle,
    parseSource,
    highlightAt,
    readyForContent,
    variants,
    setCode,
  ]);

  return { overlaidCode };
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
  const initialFilename = activeCode?.[variantName]?.filesOrder
    ? activeCode[variantName].filesOrder[0]
    : activeCode?.[variantName]?.fileName;
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
  // TODO: we also need to highlight the transforms and memoize them
  const { overlaidCode } = useHighlighter({
    highlightAt,
    isControlled,
    activeCode,
    readyForContent,
    variants,
    setCode,
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
      setCode: controlledSetCode || setCode,
      selection: controlledSelection || selection,
      setSelection: controlledSetSelection || setSelection,
      components: controlledComponents || props.components,
    }),
    [
      overlaidCode,
      controlledCode,
      code,
      controlledSetCode,
      setCode,
      selection,
      controlledSelection,
      controlledSetSelection,
      controlledComponents,
      props.components,
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
