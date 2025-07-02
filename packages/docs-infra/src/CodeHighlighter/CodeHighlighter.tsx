import type {
  Code,
  CodeHighlighterProps,
  ContentLoadingProps,
  Fallback,
  VariantCode,
  VariantExtraFiles,
  VariantSource,
} from './types';

import * as React from 'react';
import { loadVariant } from './loadVariant';
import { loadFallbackVariant } from './loadFallbackVariant';
import { stringOrHastToJsx } from './hast';

interface CodeHighlighterInnerProps extends Omit<CodeHighlighterProps, 'precompute'> {
  fallback?: Fallback;
}

interface CodeHighlighterWithInitialSourceProps extends Omit<CodeHighlighterProps, 'precompute'> {
  code: Code;
  initialVariant: string;
  initialFilename: string;
  initialSource: VariantSource;
  initialExtraFiles?: VariantExtraFiles;
  ContentLoading: React.ComponentType<ContentLoadingProps>;
}

interface CodeInitialSourceLoaderProps extends Omit<CodeHighlighterProps, 'precompute'> {
  initialVariant: string;
  initial?: VariantCode;
  ContentLoading: React.ComponentType<ContentLoadingProps>;
}

const DEFAULT_HIGHLIGHT_AT = 'stream';

function HighlightErrorHandler({ error }: { error: Error }) {
  return <div>Error: {error.message}</div>;
}

function isSourceLoaded(code: { source?: VariantSource }, highlightAt?: string): boolean {
  if (!code.source) {
    return false;
  }

  if (typeof code.source === 'string' && highlightAt === 'init') {
    // TODO: handle 'stream' case
    return false;
  }

  // if it's a hast node or hastJson, we assume it's loaded
  return true;
}

async function CodeSourceLoader(props: CodeHighlighterInnerProps) {
  const ErrorHandler = props.ErrorHandler || HighlightErrorHandler;

  // TODO: if props.variant is provided, we should only load that variant

  const variantNames = Object.keys(props.components || props.code || {});
  const variantCodes = await Promise.all(
    variantNames.map((variantName) =>
      loadVariant(variantName, props.url, props.code?.[variantName]).catch((error) => ({ error })),
    ),
  );

  const code: Code = {};
  const errors: Error[] = [];
  for (const variant of variantCodes) {
    if ('error' in variant) {
      errors.push(variant.error);
    } else {
      code[variant.variant] = variant.code;
    }
  }

  if (errors.length > 0) {
    return (
      <ErrorHandler
        error={
          new Error(`Failed loading code: ${errors.map((err) => JSON.stringify(err)).join('\n ')}`)
        }
      />
    );
  }

  return <div>test</div>;
}

function CodeHighlighterInner(props: CodeHighlighterInnerProps) {
  const ErrorHandler = props.ErrorHandler || HighlightErrorHandler;

  const variants = props.code;
  const variantNames = Object.keys(props.components || variants || {});
  const allCodeVariantsLoaded = variantNames.every((variant) => {
    const codeVariant = variants?.[variant];
    if (!codeVariant || !isSourceLoaded(codeVariant, props.highlightAt)) {
      return false;
    }

    const extraFiles = codeVariant.extraFiles;
    if (!extraFiles) {
      return true;
    }

    return Object.keys(extraFiles).every((file) => {
      const extraFile = extraFiles[file];
      if (!extraFile || !isSourceLoaded(extraFile, props.highlightAt)) {
        return false;
      }

      return true;
    });
  });

  if (!variants || !allCodeVariantsLoaded) {
    if (props.clientOnly) {
      return (
        <ErrorHandler error={new Error('Client only mode requires precomputed source code')} />
      );
    }

    return <CodeSourceLoader {...props} />;
  }

  return <div>test</div>; // TODO: to codehighlighterclient
}

/**
 * Ensures that the suspense boundary is always rendered, even if none of the children have async operations.
 */
async function CodeHighlighterSuspense(props: { children: React.ReactNode }) {
  return props.children;
}

function CodeHighlighterWithInitialSource(props: CodeHighlighterWithInitialSourceProps) {
  const fileNames = [props.initialFilename, ...Object.keys(props.initialExtraFiles || {})];
  const source = stringOrHastToJsx(props.initialSource, props.highlightAt === 'init');

  const ContentLoading = props.ContentLoading;
  const fallback = <ContentLoading fileNames={fileNames} source={source} />;

  const innerProps: CodeHighlighterInnerProps = {
    ...props,
    fallback,
  };
  delete (innerProps as any).initialFilename;
  delete (innerProps as any).initialSource;
  delete (innerProps as any).initialExtraFiles;

  if (props.clientOnly) {
    return <CodeHighlighterInner {...innerProps} />;
  }

  return (
    <React.Suspense fallback={fallback}>
      <CodeHighlighterSuspense>
        <CodeHighlighterInner {...innerProps} />
      </CodeHighlighterSuspense>
    </React.Suspense>
  );
}

async function CodeInitialSourceLoader(props: CodeInitialSourceLoaderProps) {
  const ErrorHandler = props.ErrorHandler || HighlightErrorHandler;

  const loaded = await loadFallbackVariant(
    props.initialVariant,
    props.highlightAt === 'init',
    props.code || {},
    props.initial,
  ).catch((error) => ({ error }));
  if ('error' in loaded) {
    return <ErrorHandler error={loaded.error} />;
  }

  const { code, initialFilename, initialSource, initialExtraFiles } = loaded;

  const propsWithInitialSource: CodeHighlighterWithInitialSourceProps = {
    ...props,
    code,
    initialFilename,
    initialSource,
    initialExtraFiles,
  };
  delete (propsWithInitialSource as any).initial;

  return <CodeHighlighterWithInitialSource {...propsWithInitialSource} />;
}

function CodeHighlighter(props: CodeHighlighterProps) {
  const ErrorHandler = props.ErrorHandler || HighlightErrorHandler;

  if (props.precompute === true) {
    return <ErrorHandler error={new Error('Precompute enabled, but not provided')} />;
  }

  const code = props.precompute || props.code;
  const variants = Object.keys(props.components || code || {});
  if (variants.length === 0) {
    return <ErrorHandler error={new Error('No code or components provided')} />;
  }

  const ContentLoading = props.ContentLoading;
  if (!ContentLoading) {
    if (props.highlightAt === 'stream') {
      // if the user explicitly sets highlightAt to 'stream', we need a ContentLoading component
      return (
        <ErrorHandler
          error={new Error('ContentLoading component is required for stream highlighting')}
        />
      );
    }

    const innerProps: CodeHighlighterInnerProps = {
      ...props,
      code,
    };
    delete (innerProps as any).precompute;

    return <CodeHighlighterInner {...innerProps} />;
  }

  const initialKey = props.initialVariant || props.variant || props.defaultVariant || 'Default';
  const initial = code?.[initialKey];
  if (!initial && !props.components?.[initialKey]) {
    return <ErrorHandler error={new Error(`No code or component for variant "${initialKey}"`)} />;
  }

  const initialSource = initial?.source;
  const highlightAt = props.highlightAt || DEFAULT_HIGHLIGHT_AT;

  // TODO: handle fallbackUsesAllVariants and fallbackUsesExtraFiles

  if (!code || !initialSource || (highlightAt === 'init' && typeof initialSource === 'string')) {
    if (props.clientOnly) {
      if (!initialSource) {
        return (
          <ErrorHandler error={new Error('Client only mode requires precomputed source code')} />
        );
      }

      return (
        <ErrorHandler
          error={
            new Error(
              'Client only mode with highlightAt: init requires precomputed and parsed source code',
            )
          }
        />
      );
    }

    const propsWithInitial: CodeInitialSourceLoaderProps = {
      ...props,
      ContentLoading,
      initialVariant: initialKey,
      initial,
    };
    delete (propsWithInitial as any).precompute;

    return <CodeInitialSourceLoader {...propsWithInitial} />;
  }

  const propsWithInitialSource: CodeHighlighterWithInitialSourceProps = {
    ...props,
    code,
    ContentLoading,
    initialVariant: initialKey,
    initialFilename: initial.fileName,
    initialSource,
    initialExtraFiles: initial.extraFiles,
  };
  delete (propsWithInitialSource as any).precompute;

  return <CodeHighlighterWithInitialSource {...propsWithInitialSource} />;
}

export default CodeHighlighter;
