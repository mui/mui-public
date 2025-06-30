import * as React from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { toText } from 'hast-util-to-text';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';

import type { Nodes as HastNodes } from 'hast';

export type Components = { [key: string]: React.ReactNode };

type CodeMeta = {
  fileName: string;
};
type VariantExtraFiles = {
  [fileName: string]: null | (CodeMeta & { source?: string | HastNodes | { hastJson: string } });
};
type VariantCode = CodeMeta & {
  source?: string | HastNodes | { hastJson: string };
  extraFiles?: VariantExtraFiles;
};
type Code = { [key: string]: VariantCode };
type ParsedVariantCode = CodeMeta & {
  source: HastNodes | { hastJson: string };
  extraFiles: { [fileName: string]: CodeMeta & { source: HastNodes | { hastJson: string } } };
};
type ParsedCode = { [key: string]: ParsedVariantCode };

type Options = { name?: string; slug?: string; description?: string };
export type ContentProps = { code: ParsedCode; components?: Components } & Options;
export type ContentLoadingProps = { fileNames: string[]; source: React.ReactNode };

type ErrorHandler = React.ComponentType<{ error: Error }>;

export type CodeHighlighterClientProps = Options & {
  Content: React.ComponentType<ContentProps>;
  code?: Code;
  components?: Components;
  variant?: string;
  defaultVariant?: string;
  ErrorHandler?: ErrorHandler;
  highlightAt?: 'init' | 'stream' | 'hydration' | 'idle';
  url?: string;
  fallback?: React.ReactNode;
};

export type CodeHighlighterInnerProps = Options & {
  Content: React.ComponentType<ContentProps>;
  code?: Code;
  components?: Components;
  variant?: string;
  defaultVariant?: string;
  ErrorHandler?: ErrorHandler;
  clientOnly?: boolean;
  highlightAt?: 'init' | 'stream' | 'hydration' | 'idle';
  url?: string;
  fallback?: React.ReactNode;
  loadVariantCode?: (variantName: string, url?: string) => Promise<VariantCode>;
  loadSource?: (variantName: string, fileName: string, url?: string) => Promise<string>;
  parseSource?: (source: string) => Promise<HastNodes>;
};

type CodeHighlighterWithInitialSourceProps = Options & {
  Content: React.ComponentType<ContentProps>;
  code: Code; // e
  initialVariant: string; // e
  initialFilename: string; // e
  initialSource: string | HastNodes | { hastJson: string }; // e
  initialExtraFiles?: VariantExtraFiles; // e
  components?: Components;
  variant?: string;
  defaultVariant?: string;
  ContentLoading: React.ComponentType<ContentLoadingProps>; // e
  ErrorHandler?: ErrorHandler;
  clientOnly?: boolean;
  highlightAt?: 'init' | 'stream' | 'hydration' | 'idle';
  fallbackUsesExtraFiles?: boolean;
  fallbackUsesAllVariants?: boolean;
  url?: string;
  loadVariantCode?: (variantName: string, url?: string) => Promise<VariantCode>;
  loadSource?: (variantName: string, fileName: string, url?: string) => Promise<string>;
  parseSource?: (source: string) => Promise<HastNodes>;
};

type CodeInitialSourceLoaderProps = Options & {
  Content: React.ComponentType<ContentProps>;
  code?: Code;
  components?: Components;
  variant?: string;
  initialVariant: string; // e
  initial?: VariantCode; // e
  defaultVariant?: string;
  precompute?: boolean | Code;
  ContentLoading: React.ComponentType<ContentLoadingProps>;
  ErrorHandler?: ErrorHandler;
  clientOnly?: boolean;
  highlightAt?: 'init' | 'stream' | 'hydration' | 'idle';
  fallbackUsesExtraFiles?: boolean;
  fallbackUsesAllVariants?: boolean;
  url?: string;
  loadVariantCode?: (variantName: string, url?: string) => Promise<VariantCode>;
  loadSource?: (variantName: string, fileName: string, url?: string) => Promise<string>;
  parseSource?: (source: string) => Promise<HastNodes>;
};

export type CodeHighlighterProps = Options & {
  Content: React.ComponentType<ContentProps>;
  code?: Code;
  components?: Components;
  variant?: string;
  initialVariant?: string;
  defaultVariant?: string;
  precompute?: boolean | Code;
  ContentLoading?: React.ComponentType<ContentLoadingProps>;
  ErrorHandler?: ErrorHandler;
  clientOnly?: boolean;
  highlightAt?: 'init' | 'stream' | 'hydration' | 'idle';
  fallbackUsesExtraFiles?: boolean;
  fallbackUsesAllVariants?: boolean;
  url?: string;
  loadVariantCode?: (variantName: string, url?: string) => Promise<VariantCode>;
  loadSource?: (variantName: string, fileName: string, url?: string) => Promise<string>;
  parseSource?: (source: string) => Promise<HastNodes>;
};

const DEFAULT_HIGHLIGHT_AT = 'stream';

function HighlightErrorHandler({ error }: { error: Error }) {
  return <div>Error: {error.message}</div>;
}

function isSourceLoaded(
  code: { source?: string | HastNodes | { hastJson: string } },
  highlightAt?: string,
): boolean {
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
    variantNames.map(
      async (variant): Promise<{ error: Error } | { variant: string; code: VariantCode }> => {
        let codeVariant = props.code?.[variant];
        if (!codeVariant) {
          const loadVariantCode = props.loadVariantCode;
          if (!loadVariantCode) {
            return {
              error: new Error(
                '"loadVariantCode" function is required when filenames are not provided',
              ),
            };
          }

          try {
            codeVariant = await loadVariantCode(variant, props.url);
          } catch (error) {
            return {
              error: new Error(
                `Failed to load variant code (variant: ${variant}, url: ${props.url}): ${JSON.stringify(error)}`,
              ),
            };
          }
        }

        const filename = codeVariant.fileName;
        let source = codeVariant.source;
        if (!source) {
          const loadSource = props.loadSource;
          if (!loadSource) {
            return {
              error: new Error('"loadSource" function is required when source is not provided'),
            };
          }

          try {
            source = await loadSource(variant, filename, props.url);
            codeVariant = { ...codeVariant, source };
          } catch (error) {
            return {
              error: new Error(
                `Failed to load source code (variant: ${variant}, file: ${filename}, url: ${props.url}): ${JSON.stringify(error)}`,
              ),
            };
          }
        }

        if (typeof source === 'string') {
          const parseSource = props.parseSource;
          if (!parseSource) {
            return {
              error: new Error(
                '"parseSource" function is required when source is a string and highlightAt is "init"',
              ),
            };
          }

          try {
            source = await parseSource(source);
            codeVariant = { ...codeVariant, source };
          } catch (error) {
            return {
              error: new Error(
                `Failed to parse source code (variant: ${variant}, file: ${filename}, url: ${props.url}): ${JSON.stringify(error)}`,
              ),
            };
          }
        }

        // TODO: extraFiles handling

        return {
          variant,
          code: codeVariant,
        };
      },
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

export function hastToJsx(hast: HastNodes): React.ReactNode {
  return toJsxRuntime(hast, { Fragment, jsx, jsxs });
}

export function hastOrJsonToJsx(hastOrJson: HastNodes | { hastJson: string }): React.ReactNode {
  let hast: HastNodes;
  if ('hastJson' in hastOrJson) {
    try {
      hast = JSON.parse(hastOrJson.hastJson);
    } catch (error) {
      throw new Error(`Failed to parse hastJson: ${JSON.stringify(error)}`);
    }
  } else {
    hast = hastOrJson;
  }

  return toJsxRuntime(hast, { Fragment, jsx, jsxs });
}

function stringOrHastToJsx(
  source: string | HastNodes | { hastJson: string },
  highlighted?: boolean,
): React.ReactNode {
  if (typeof source === 'string') {
    return <pre>{source}</pre>;
  }

  let hast: HastNodes;
  if ('hastJson' in source) {
    try {
      hast = JSON.parse(source.hastJson);
    } catch (error) {
      throw new Error(`Failed to parse hastJson: ${JSON.stringify(error)}`);
    }
  } else {
    hast = source;
  }

  if (highlighted) {
    return <pre>{hastToJsx(hast)}</pre>;
  }

  return <pre>{toText(hast)}</pre>;
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
  delete (innerProps as any).ContentLoading;
  delete (innerProps as any).initialVariant;
  delete (innerProps as any).initialFilename;
  delete (innerProps as any).initialSource;
  delete (innerProps as any).initialExtraFiles;
  delete (innerProps as any).fallbackUsesExtraFiles;
  delete (innerProps as any).fallbackUsesAllVariants;

  if (props.clientOnly) {
    return <CodeHighlighterInner {...innerProps} />;
  }

  return (
    <React.Suspense fallback={fallback}>
      {/* TODO: We need to wrap this in async so it always fallsback */}
      <CodeHighlighterInner {...innerProps} />
    </React.Suspense>
  );
}

async function CodeInitialSourceLoader(props: CodeInitialSourceLoaderProps) {
  const ErrorHandler = props.ErrorHandler || HighlightErrorHandler;

  const code = props.code || {};
  let initial = props.initial;
  if (!initial) {
    const loadVariantCode = props.loadVariantCode;
    if (!loadVariantCode) {
      return (
        <ErrorHandler
          error={
            new Error(
              '"loadVariantCode" function is required when initial filenames are not provided',
            )
          }
        />
      );
    }

    try {
      initial = await loadVariantCode(props.initialVariant, props.url);
      code[props.initialVariant] = initial;
    } catch (error) {
      return (
        <ErrorHandler
          error={
            new Error(
              `Failed to load initial variant code (variant: ${props.initialVariant}, url: ${props.url}): ${JSON.stringify(error)}`,
            )
          }
        />
      );
    }
  }

  const initialFilename = initial.fileName;
  let initialSource = initial.source;
  if (!initialSource) {
    const loadSource = props.loadSource;
    if (!loadSource) {
      return (
        <ErrorHandler
          error={new Error('"loadSource" function is required when initial source is not provided')}
        />
      );
    }

    try {
      initialSource = await loadSource(props.initialVariant, initialFilename, props.url);
      code[props.initialVariant] = { ...(code[props.initialVariant] || {}), source: initialSource };
    } catch (error) {
      return (
        <ErrorHandler
          error={
            new Error(
              `Failed to load initial source code (variant: ${props.initialVariant}, file: ${initialFilename}, url: ${props.url}): ${JSON.stringify(error)}`,
            )
          }
        />
      );
    }
  }

  if (props.highlightAt === 'init' && typeof initialSource === 'string') {
    const parseSource = props.parseSource;
    if (!parseSource) {
      return (
        <ErrorHandler
          error={
            new Error(
              '"parseSource" function is required when initial source is a string and highlightAt is "init"',
            )
          }
        />
      );
    }

    try {
      initialSource = await parseSource(initialSource);
      code[props.initialVariant] = { ...(code[props.initialVariant] || {}), source: initialSource };
    } catch (error) {
      return (
        <ErrorHandler
          error={
            new Error(
              `Failed to parse initial source code (variant: ${props.initialVariant}, file: ${initialFilename}, url: ${props.url}): ${JSON.stringify(error)}`,
            )
          }
        />
      );
    }
  }

  // TODO: handle fallbackUsesExtraFiles and fallbackUsesAllVariants

  const propsWithInitialSource: CodeHighlighterWithInitialSourceProps = {
    ...props,
    code,
    initialFilename,
    initialSource,
    initialExtraFiles: initial.extraFiles || {},
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
    delete (innerProps as any).ContentLoading;
    delete (innerProps as any).precompute;
    delete (innerProps as any).initialVariant;
    delete (innerProps as any).fallbackUsesExtraFiles;
    delete (innerProps as any).fallbackUsesAllVariants;

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

    return (
      <CodeInitialSourceLoader
        {...props}
        ContentLoading={ContentLoading}
        initialVariant={initialKey}
        initial={initial}
      />
    );
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

  return <CodeHighlighterWithInitialSource {...propsWithInitialSource} />;
}

export default CodeHighlighter;
