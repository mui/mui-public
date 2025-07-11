'use client';

import * as React from 'react';
import { useCodeContext } from '../CodeProvider/CodeContext';
import { Code, CodeHighlighterClientProps } from './types';
import { CodeHighlighterContext } from './CodeHighlighterContext';
import { maybeInitialData } from './maybeInitialData';
import { loadFallbackVariant } from './loadFallbackVariant';
import { hasAllVariants } from './hasAllVariants';
import { loadVariant } from './loadVariant';
import { CodeHighlighterFallbackContext } from './CodeHighlighterFallbackContext';
import { useControlledCode } from '../CodeControllerContext';
import { useOnHydrate } from '../useOnHydrate';
import { useOnIdle } from '../useOnIdle';
import { codeToFallbackProps } from './codeToFallbackProps';

const DEBUG = false; // Set to true for debugging purposes

export function CodeHighlighterClient(props: CodeHighlighterClientProps) {
  const { parseSource, loadVariantCode, loadSource } = useCodeContext(); // TODO: use to highlight on the client

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
  // TODO: setCode from upstream is also valid

  // TODO: if using props.variant, then the variant is controlled and we can't use our own state
  const [selection, setSelection] = React.useState({
    variant: props.initialVariant || props.defaultVariant || 'Default',
  });

  const variantName = controlledSelection?.variant || props.variant || selection.variant;
  const activeCode = controlledCode || props.code || code;
  const initialFilename = activeCode?.[variantName]?.filesOrder
    ? activeCode[variantName].filesOrder[0]
    : activeCode?.[variantName]?.fileName;
  const fileName = controlledSelection?.fileName || props.fileName || initialFilename;

  // TODO: if controlled, they might also have a setVariantName provided that we should use instead

  const variants = props.variants || Object.keys(props.components || code || {});
  const { initialData, reason } = React.useMemo(
    () =>
      maybeInitialData(
        variants,
        variantName,
        code,
        fileName,
        props.highlightAt === 'init',
        props.fallbackUsesExtraFiles,
        props.fallbackUsesAllVariants,
      ),
    [
      variants,
      variantName,
      code,
      fileName,
      props.highlightAt,
      props.fallbackUsesExtraFiles,
      props.fallbackUsesAllVariants,
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
        props.highlightAt === 'init',
        code,
        code?.[variantName],
        props.url,
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
    props.highlightAt,
    props.url,
    parseSource,
    loadSource,
    loadVariantCode,
  ]);

  const readyForContent = React.useMemo(() => {
    if (!activeCode) {
      return false;
    }

    return hasAllVariants(variants, activeCode);
  }, [activeCode, variants]);

  // Load full data if it's not already loaded
  React.useEffect(() => {
    if (readyForContent || isControlled) {
      return;
    }

    // TODO: abort controller

    (async () => {
      const result = await Promise.all(
        variants.map((name) =>
          loadVariant(
            name,
            props.url,
            code?.[name],
            parseSource,
            loadSource,
            loadVariantCode,
          ).catch((error) => ({ error })),
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
    props.url,
    code,
    parseSource,
    loadSource,
    loadVariantCode,
  ]);

  const isHydrated = useOnHydrate();
  const isIdle = useOnIdle();
  const [overlaidCode, setOverlaidCode] = React.useState<Code | undefined>();

  // Ensure all the code is highlighted
  React.useEffect(() => {
    if (!readyForContent) {
      return;
    }

    const highlightAt = props.highlightAt || 'hydration';
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
    props.highlightAt,
    readyForContent,
    variants,
  ]);

  // Prepare fallback context
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

  const context: CodeHighlighterContext = React.useMemo(
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

  if (!props.variants && !props.components && !code) {
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
      {props.content}
    </CodeHighlighterContext.Provider>
  );

  // TODO: typescript/javascript switch can be implemented using a <Content/> wrapper and a different useDemo() hook
  // this would remove the types from .ts files at runtime, but what about build time?
  // I'm thinking a CodeVariant could return a transforms: { js: { [0]: string or hastLine, [5]: string or hastLine, [6]: null (delete line) } }
  // if setTransforms(['js']) is set, it returns a transformed version
  // if setTransforms() is set, it returns the original version
  // initial transforms can be set with a cookie
}
