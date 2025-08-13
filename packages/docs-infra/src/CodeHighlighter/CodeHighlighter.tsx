import * as React from 'react';

import type {
  Code,
  CodeHighlighterClientProps,
  CodeHighlighterProps,
  ContentLoadingProps,
  ContentProps,
  VariantCode,
  VariantExtraFiles,
  VariantSource,
} from './types';

import { loadVariant } from './loadVariant';
import { loadFallbackCode } from './loadFallbackCode';
import { stringOrHastToJsx } from '../pipeline/hastUtils';
import { CodeHighlighterClient } from './CodeHighlighterClient';
import { maybeInitialData } from './maybeInitialData';
import { hasAllVariants } from './hasAllVariants';
import { getFileNameFromUrl } from '../pipeline/loaderUtils/getFileNameFromUrl';
import { CodeErrorHandler } from './CodeErrorHandler';

// Common props shared across helper functions
type BaseHelperProps<T extends {}> = Pick<
  CodeHighlighterProps<T>,
  | 'url'
  | 'code'
  | 'components'
  | 'variants'
  | 'variantType'
  | 'highlightAt'
  | 'Content'
  | 'contentProps'
  | 'ErrorHandler'
  | 'name'
  | 'slug'
  | 'loadCodeMeta'
  | 'loadVariantMeta'
  | 'loadSource'
  | 'sourceParser'
  | 'sourceTransformers'
  | 'precompute'
  | 'controlled'
  | 'variant'
  | 'fileName'
  | 'initialVariant'
  | 'defaultVariant'
  | 'forceClient'
  | 'children'
  | 'globalsCode'
>;

interface CodeSourceLoaderProps<T extends {}> extends BaseHelperProps<T> {
  fallback?: React.ReactNode;
  skipFallback?: boolean;
  processedGlobalsCode?: Array<Code>;
}

interface CodeInitialSourceLoaderProps<T extends {}> extends BaseHelperProps<T> {
  fallbackUsesExtraFiles?: boolean;
  fallbackUsesAllVariants?: boolean;
  initialVariant: string;
  ContentLoading: React.ComponentType<ContentLoadingProps<T>>;
}

const DEFAULT_HIGHLIGHT_AT = 'stream';
const DEBUG = false; // Set to true for debugging purposes

function createClientProps<T extends {}>(
  props: BaseHelperProps<T> & {
    code?: Code;
    fallback?: React.ReactNode;
    skipFallback?: boolean;
    processedGlobalsCode?: Array<Code>;
  },
): CodeHighlighterClientProps {
  const highlightAt = props.highlightAt === 'stream' ? 'init' : props.highlightAt;

  const contentProps = {
    code: props.code || props.precompute,
    components: props.components,
    name: props.name,
    slug: props.slug,
    url: props.url,
    variantType: props.variantType,
    ...(props.contentProps || {}),
  } as ContentProps<T>;

  const ErrorHandler = props.ErrorHandler || CodeErrorHandler;

  return {
    url: props.url,
    code: props.code,
    precompute: props.precompute,
    components: props.components,
    variants: props.variants,
    variant: props.variant,
    fileName: props.fileName,
    initialVariant: props.initialVariant,
    defaultVariant: props.defaultVariant,
    highlightAt: highlightAt || 'init',
    skipFallback: props.skipFallback,
    controlled: props.controlled,
    name: props.name,
    slug: props.slug,
    // Use processedGlobalsCode if available, otherwise fall back to raw globalsCode
    globalsCode: props.processedGlobalsCode || props.globalsCode,

    // Note: it is important that we render components before passing them to the client
    // otherwise we will get an error because functions can't be serialized
    // On the client, in order to send data to these components, we have to set context
    fallback: props.fallback,
    errorHandler: <ErrorHandler />,
    children: <props.Content {...contentProps} />,
  };
}

async function CodeSourceLoader<T extends {}>(props: CodeSourceLoaderProps<T>) {
  const ErrorHandler = props.ErrorHandler || CodeErrorHandler;

  // Start with the loaded code from precompute, or load it if needed
  let loadedCode = props.code || props.precompute;
  if (!loadedCode) {
    if (!props.loadCodeMeta) {
      return (
        <ErrorHandler
          errors={[new Error('No code provided and "loadCodeMeta" function is not defined')]}
        />
      );
    }

    if (!props.url) {
      return (
        <ErrorHandler
          errors={[new Error('URL is required when loading code with "loadCodeMeta"')]}
        />
      );
    }

    try {
      loadedCode = await props.loadCodeMeta(props.url);
    } catch (error) {
      return (
        <ErrorHandler
          errors={[
            new Error(
              `Failed to load code from URL: ${props.url}. Error: ${JSON.stringify(error)}`,
            ),
          ]}
        />
      );
    }
  }

  // TODO: if props.variant is provided, we should only load that variant

  // Process globalsCode: use already processed version if available, otherwise convert string URLs to Code objects
  let processedGlobalsCode: Array<Code> | undefined = props.processedGlobalsCode;
  if (!processedGlobalsCode && props.globalsCode && props.globalsCode.length > 0) {
    const hasStringUrls = props.globalsCode.some((item) => typeof item === 'string');
    if (hasStringUrls && !props.loadCodeMeta) {
      return (
        <ErrorHandler
          errors={[
            new Error('loadCodeMeta function is required when globalsCode contains string URLs'),
          ]}
        />
      );
    }

    // Load all string URLs in parallel, keep Code objects as-is
    const globalsPromises = props.globalsCode.map(async (globalItem) => {
      if (typeof globalItem === 'string') {
        // String URL - load Code object via loadCodeMeta
        try {
          return await props.loadCodeMeta!(globalItem);
        } catch (error) {
          throw new Error(
            `Failed to load globalsCode from URL: ${globalItem}. Error: ${JSON.stringify(error)}`,
          );
        }
      } else {
        // Code object - return as-is
        return globalItem;
      }
    });

    try {
      processedGlobalsCode = await Promise.all(globalsPromises);
    } catch (error) {
      return <ErrorHandler errors={[error as Error]} />;
    }
  }

  const variantNames = Object.keys(props.components || loadedCode || {});
  const variantCodes = await Promise.all(
    variantNames.map((variantName) => {
      const variantCode = loadedCode[variantName];
      const variantUrl =
        typeof variantCode === 'object' && variantCode?.url ? variantCode.url : props.url;

      // Convert processedGlobalsCode to VariantCode | string for this specific variant
      let resolvedGlobalsCode: Array<VariantCode | string> | undefined;
      if (processedGlobalsCode && processedGlobalsCode.length > 0) {
        resolvedGlobalsCode = [];
        for (const codeObj of processedGlobalsCode) {
          // Only include if this variant exists in the globalsCode
          const targetVariant = codeObj[variantName];
          if (targetVariant) {
            resolvedGlobalsCode.push(targetVariant);
          }
        }
      }

      return loadVariant(
        variantUrl,
        variantName,
        variantCode,
        props.sourceParser,
        props.loadSource,
        props.loadVariantMeta,
        props.sourceTransformers,
        { globalsCode: resolvedGlobalsCode },
      )
        .then((variant) => ({ name: variantName, variant }))
        .catch((error) => ({ error }));
    }),
  );

  const processedCode: Code = {};
  const errors: Error[] = [];
  for (const item of variantCodes) {
    if ('error' in item) {
      errors.push(item.error);
    } else {
      processedCode[item.name] = item.variant.code;
    }
  }

  if (errors.length > 0) {
    return <ErrorHandler errors={errors} />;
  }

  const clientProps = createClientProps({
    ...props,
    code: processedCode,
    processedGlobalsCode,
  });

  return <CodeHighlighterClient {...clientProps} />;

  // TODO: we might not need the client if hydrateAt is 'init' or 'stream' and there is no setCode() or setSelection()
}

function renderCodeHighlighter<T extends {}>(
  props: BaseHelperProps<T> & {
    fallback?: React.ReactNode;
    skipFallback?: boolean;
    processedGlobalsCode?: Array<Code>;
  },
) {
  const ErrorHandler = props.ErrorHandler || CodeErrorHandler;

  const code = props.code || props.precompute;
  const variants = props.variants || Object.keys(props.components || code || {});
  const allCodeVariantsLoaded = code && hasAllVariants(variants, code, true);

  if (!allCodeVariantsLoaded) {
    if (props.forceClient) {
      return (
        <ErrorHandler errors={[new Error('Client only mode requires precomputed source code')]} />
      );
    }

    return <CodeSourceLoader {...props} />;
  }

  const clientProps = createClientProps({
    ...props,
  });

  return <CodeHighlighterClient {...clientProps} />;

  // TODO: we might not need the client if hydrateAt is 'init' or 'stream' and there is no props.controlled
}

/**
 * Ensures that the suspense boundary is always rendered, even if none of the children have async operations.
 */
async function CodeHighlighterSuspense(props: { children: React.ReactNode }) {
  return props.children;
}

function renderWithInitialSource<T extends {}>(
  props: BaseHelperProps<T> & {
    code: Code;
    initialVariant: string;
    initialFilename: string | undefined;
    initialSource: VariantSource;
    initialExtraFiles?: VariantExtraFiles;
    ContentLoading: React.ComponentType<ContentLoadingProps<T>>;
    processedGlobalsCode?: Array<Code>;
  },
) {
  const fileNames = [
    ...(props.initialFilename ? [props.initialFilename] : []),
    ...Object.keys(props.initialExtraFiles || {}),
  ];
  const source = stringOrHastToJsx(props.initialSource, props.highlightAt === 'init');

  const contentProps = {
    name: props.name,
    slug: props.slug,
    url: props.url,
    fileNames,
    source,
    ...(props.contentProps || {}),
  } as ContentLoadingProps<T>;

  const ContentLoading = props.ContentLoading;
  const fallback = <ContentLoading {...contentProps} />;

  if (props.forceClient) {
    return renderCodeHighlighter({
      ...props,
      fallback,
      processedGlobalsCode: props.processedGlobalsCode,
    });
  }

  return (
    <React.Suspense fallback={fallback}>
      <CodeHighlighterSuspense>
        {renderCodeHighlighter({
          ...props,
          fallback,
          skipFallback: true,
          processedGlobalsCode: props.processedGlobalsCode,
        })}
      </CodeHighlighterSuspense>
    </React.Suspense>
  );
}

async function CodeInitialSourceLoader<T extends {}>(props: CodeInitialSourceLoaderProps<T>) {
  const ErrorHandler = props.ErrorHandler || CodeErrorHandler;

  if (!props.url) {
    return <ErrorHandler errors={[new Error('URL is required for loading initial source')]} />;
  }

  const loaded = await loadFallbackCode(
    props.url,
    props.initialVariant,
    props.code,
    props.highlightAt === 'init',
    props.fallbackUsesExtraFiles,
    props.fallbackUsesAllVariants,
    props.sourceParser,
    props.loadSource,
    props.loadVariantMeta,
    props.loadCodeMeta,
    props.fileName,
    props.variants,
    props.globalsCode,
  ).catch((error) => ({ error }));
  if ('error' in loaded) {
    return <ErrorHandler errors={[loaded.error]} />;
  }

  const { code, initialFilename, initialSource, initialExtraFiles, processedGlobalsCode } = loaded;

  return renderWithInitialSource({
    ...props,
    code,
    initialFilename,
    initialSource,
    initialExtraFiles,
    ContentLoading: props.ContentLoading,
    processedGlobalsCode,
  });
}

export function CodeHighlighter<T extends {}>(props: CodeHighlighterProps<T>) {
  const ErrorHandler = props.ErrorHandler || CodeErrorHandler;

  // Validate mutually exclusive props
  if (props.children && (props.code || props.precompute)) {
    return (
      <ErrorHandler
        errors={[new Error('Cannot provide both "children" and "code" or "precompute" props')]}
      />
    );
  }

  // Handle children as string -> Default variant
  let code = props.code;
  if (props.children && typeof props.children === 'string') {
    const fileName =
      props.fileName || (props.url ? getFileNameFromUrl(props.url).fileName : undefined);
    code = {
      Default: {
        fileName,
        source: props.children,
        url: props.url,
      },
    };
  }

  const variants =
    props.variants || Object.keys(props.components || code || props.precompute || {});
  if (variants.length === 0) {
    return <ErrorHandler errors={[new Error('No code or components provided')]} />;
  }

  // Validate fileName is provided when extraFiles are present
  if (code) {
    for (const [variantName, variantCode] of Object.entries(code)) {
      if (
        typeof variantCode === 'object' &&
        variantCode?.extraFiles &&
        Object.keys(variantCode.extraFiles).length > 0 &&
        !variantCode.fileName &&
        !variantCode.url
      ) {
        return (
          <ErrorHandler
            errors={[
              new Error(
                `fileName or url is required for variant "${variantName}" when extraFiles are provided`,
              ),
            ]}
          />
        );
      }
    }
  }

  const ContentLoading = props.ContentLoading;
  if (!ContentLoading) {
    if (props.highlightAt === 'stream') {
      // if the user explicitly sets highlightAt to 'stream', we need a ContentLoading component
      return (
        <ErrorHandler
          errors={[new Error('ContentLoading component is required for stream highlighting')]}
        />
      );
    }

    return renderCodeHighlighter({
      ...props,
      code,
    });
  }

  const initialKey = props.initialVariant || props.variant || props.defaultVariant || variants[0];
  const initial = code?.[initialKey];
  if (!initial && !props.components?.[initialKey]) {
    return (
      <ErrorHandler errors={[new Error(`No code or component for variant "${initialKey}"`)]} />
    );
  }

  // TODO: use initial.filesOrder to determing which source to use
  const highlightAt = props.highlightAt || DEFAULT_HIGHLIGHT_AT;

  const { initialData, reason } = maybeInitialData(
    variants,
    initialKey,
    code || props.precompute,
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
            errors={[
              new Error(
                'Client only mode with highlightAt: init requires precomputed and parsed source code',
              ),
            ]}
          />
        );
      }

      // TODO: send directly to client component?
      return (
        <ErrorHandler errors={[new Error('Client only mode requires precomputed source code')]} />
      );
    }

    return (
      <CodeInitialSourceLoader
        {...props}
        ContentLoading={ContentLoading}
        initialVariant={initialKey}
      />
    );
  }

  return renderWithInitialSource({
    ...props,
    code: initialData.code,
    ContentLoading,
    initialVariant: initialKey,
    initialFilename: initialData.initialFilename,
    initialSource: initialData.initialSource,
    initialExtraFiles: initialData.initialExtraFiles,
  });
}
