import * as React from 'react';

import type {
  Code,
  CodeHighlighterClientProps,
  CodeHighlighterProps,
  ContentLoadingProps,
  VariantCode,
  VariantExtraFiles,
  VariantSource,
} from './types';

import { loadVariant } from './loadVariant';
import { loadFallbackCode } from './loadFallbackCode';
import { stringOrHastToJsx } from '../hast';
import { CodeHighlighterClient } from './CodeHighlighterClient';
import { maybeInitialData } from './maybeInitialData';
import { hasAllVariants } from './hasAllVariants';

interface CodeHighlighterInnerProps extends Omit<CodeHighlighterProps, 'precompute'> {
  fallback?: React.ReactNode;
  skipFallback?: boolean;
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
  initial?: VariantCode | string;
  ContentLoading: React.ComponentType<ContentLoadingProps>;
}

const DEFAULT_HIGHLIGHT_AT = 'stream';
const DEBUG = false; // Set to true for debugging purposes

function HighlightErrorHandler({ error }: { error: Error }) {
  return <div>Error: {error.message}</div>;
}

async function CodeSourceLoader(props: CodeHighlighterInnerProps) {
  const ErrorHandler = props.ErrorHandler || HighlightErrorHandler;

  let code = props.code;
  if (!code) {
    if (!props.loadCodeMeta) {
      return (
        <ErrorHandler
          error={new Error('No code provided and "loadCodeMeta" function is not defined')}
        />
      );
    }

    try {
      code = await props.loadCodeMeta(props.url);
    } catch (error) {
      return (
        <ErrorHandler
          error={
            new Error(`Failed to load code from URL: ${props.url}. Error: ${JSON.stringify(error)}`)
          }
        />
      );
    }
  }

  // TODO: if props.variant is provided, we should only load that variant

  const variantNames = Object.keys(props.components || props.code || {});
  const variantCodes = await Promise.all(
    variantNames.map((variantName) =>
      loadVariant(
        props.url,
        variantName,
        code[variantName],
        props.parseSource,
        props.loadSource,
        props.loadVariantMeta,
        props.sourceTransformers,
      )
        .then((variant) => ({ name: variantName, variant }))
        .catch((error) => ({ error })),
    ),
  );

  const result: Code = {};
  const errors: Error[] = [];
  for (const item of variantCodes) {
    if ('error' in item) {
      errors.push(item.error);
    } else {
      result[item.name] = item.variant.code;
    }
  }

  if (errors.length > 0) {
    return (
      <ErrorHandler
        error={new Error(`Failed loading code: ${errors.map((err) => err.message).join('\n ')}`)}
      />
    );
  }

  // type Options = { name?: string; slug?: string; description?: string };
  // export type ContentProps = { code: Code; components?: Components } & Options;

  return (
    <props.Content
      code={result}
      components={props.components}
      name={props.name}
      slug={props.slug}
      description={props.description}
    />
  );

  // const highlightAt = props.highlightAt === 'stream' ? 'init' : props.highlightAt;
  // const clientProps: CodeHighlighterClientProps = {
  //   ...props,
  //   code,
  //   highlightAt: highlightAt || 'init',
  //   fallback: props.fallback,
  //   children: (
  //     <props.Content
  //       code={code}
  //       components={props.components}
  //       name={props.name}
  //       slug={props.slug}
  //       description={props.description}
  //     />
  //   ),
  // };
  // delete (clientProps as any).forceClient;
  // delete (clientProps as any).loadVariantMeta;
  // delete (clientProps as any).loadSource;
  // delete (clientProps as any).parseSource;
  // delete (clientProps as any).sourceTransformers;

  // // TODO:
  // delete (clientProps as any).Content;
  // delete (clientProps as any).ContentLoading;
  // delete (clientProps as any).ErrorHandler;

  // return <CodeHighlighterClient {...clientProps} />;

  // TODO: we might not need the client if hydrateAt is 'init' or 'stream' and there is no setCode() or setSelection()
}

// TODO: refactor Inner component out?
function CodeHighlighterInner(props: CodeHighlighterInnerProps) {
  const ErrorHandler = props.ErrorHandler || HighlightErrorHandler;

  const code = props.code; // TODO: precompute?
  const variants = props.variants || Object.keys(props.components || code || {});
  const allCodeVariantsLoaded = code && hasAllVariants(variants, code, true);

  if (!allCodeVariantsLoaded) {
    if (props.forceClient) {
      return (
        <ErrorHandler error={new Error('Client only mode requires precomputed source code')} />
      );
    }

    return <CodeSourceLoader {...props} />;
  }

  return (
    <props.Content
      code={code}
      components={props.components}
      name={props.name}
      slug={props.slug}
      description={props.description}
    />
  );

  // const highlightAt = props.highlightAt === 'stream' ? 'init' : props.highlightAt;
  // const clientProps: CodeHighlighterClientProps = {
  //   ...props,
  //   code,
  //   highlightAt: highlightAt || 'init',
  //   fallback: props.fallback,
  //   children: (
  //     <props.Content
  //       code={code}
  //       components={props.components}
  //       name={props.name}
  //       slug={props.slug}
  //       description={props.description}
  //     />
  //   ),
  // };
  // delete (clientProps as any).forceClient;
  // delete (clientProps as any).loadVariantMeta;
  // delete (clientProps as any).loadSource;
  // delete (clientProps as any).parseSource;
  // delete (clientProps as any).sourceTransformers;

  // // TODO:
  // delete (clientProps as any).Content;
  // delete (clientProps as any).ContentLoading;
  // delete (clientProps as any).ErrorHandler;

  // return <CodeHighlighterClient {...clientProps} />;
  // TODO: we might not need the client if hydrateAt is 'init' or 'stream' and there is no setCode() or setVariantName()
}

/**
 * Ensures that the suspense boundary is always rendered, even if none of the children have async operations.
 */
async function CodeHighlighterSuspense(props: { children: React.ReactNode }) {
  return props.children;
}

function CodeHighlighterWithInitialSource(props: CodeHighlighterWithInitialSourceProps) {
  const fileNames = [props.initialFilename, ...Object.keys(props.initialExtraFiles || {})]; // TODO: use filesOrder if provided
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

  if (props.forceClient) {
    return <CodeHighlighterInner {...innerProps} />;
  }

  return (
    <React.Suspense fallback={fallback}>
      <CodeHighlighterSuspense>
        <CodeHighlighterInner {...innerProps} skipFallback />
      </CodeHighlighterSuspense>
    </React.Suspense>
  );
}

async function CodeInitialSourceLoader(props: CodeInitialSourceLoaderProps) {
  const ErrorHandler = props.ErrorHandler || HighlightErrorHandler;

  const loaded = await loadFallbackCode(
    props.url,
    props.initialVariant,
    props.code,
    props.highlightAt === 'init',
    props.fallbackUsesExtraFiles,
    props.fallbackUsesAllVariants,
    props.parseSource,
    props.loadSource,
    props.loadVariantMeta,
    props.loadCodeMeta,
  ).catch((error) => ({ error }));
  if ('error' in loaded) {
    return <ErrorHandler error={loaded.error} />;
  }

  const { code, initialFilename, initialSource, initialExtraFiles, allFileNames } = loaded;

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

export function CodeHighlighter(props: CodeHighlighterProps) {
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

  // TODO: use initial.filesOrder to determing which source to use
  const highlightAt = props.highlightAt || DEFAULT_HIGHLIGHT_AT;

  const { initialData, reason } = maybeInitialData(
    variants,
    initialKey,
    code,
    undefined, // TODO: use initial.filesOrder if provided?
    highlightAt === 'init',
    props.fallbackUsesExtraFiles,
    props.fallbackUsesAllVariants,
  );

  if (!initialData) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.log('Initial data not found:', reason);
    }

    if (props.forceClient) {
      if (highlightAt === 'init') {
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

      // TODO: send directly to client component?
      return (
        <ErrorHandler error={new Error('Client only mode requires precomputed source code')} />
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
    code: initialData.code,
    ContentLoading,
    initialVariant: initialKey,
    initialFilename: initialData.initialFilename,
    initialSource: initialData.initialSource,
    initialExtraFiles: initialData.initialExtraFiles,
  };
  delete (propsWithInitialSource as any).precompute;

  return <CodeHighlighterWithInitialSource {...propsWithInitialSource} />;
}
