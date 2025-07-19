import type { Nodes as HastNodes } from 'hast';
import type { Delta } from 'jsondiffpatch';

export type Components = { [key: string]: React.ReactNode };

type CodeMeta = {
  fileName: string;
};

export type Transforms = Record<string, { delta: Delta; fileName?: string }>;

export type VariantSource = string | HastNodes | { hastJson: string };
export type VariantExtraFiles = {
  [fileName: string]: string | { source?: VariantSource; transforms?: Transforms };
};
export type VariantCode = CodeMeta & {
  url: string;
  source?: VariantSource;
  extraFiles?: VariantExtraFiles;
  filesOrder?: string[];
  transforms?: Transforms;
  allFilesListed?: boolean;
};
export type Code = { [key: string]: undefined | string | VariantCode }; // TODO: only preload should be able to pass highlighted code

export type ControlledVariantExtraFiles = {
  [fileName: string]: { source: string | null };
};
export type ControlledVariantCode = CodeMeta & {
  url: string;
  source?: string | null;
  extraFiles?: ControlledVariantExtraFiles;
  filesOrder?: string[];
};
export type ControlledCode = { [key: string]: undefined | null | ControlledVariantCode };

type Options = { name?: string; slug?: string; description?: string };
export type ContentProps = { code?: Code; components?: Components } & Options;
export type ContentLoadingVariant = {
  fileNames?: string[];
  source?: React.ReactNode;
  extraSource?: { [fileName: string]: React.ReactNode };
};
export type ContentLoadingProps = ContentLoadingVariant & {
  extraVariants?: Record<string, ContentLoadingVariant>;
} & Options;

type ErrorHandler = React.ComponentType<{ error: Error }>;

interface CodeHighlighterBaseProps extends Options {
  code?: Code;
  components?: Components; // TODO: rename to preview
  variants?: string[];
  variant?: string;
  fileName?: string;
  initialVariant?: string;
  defaultVariant?: string;
  precompute?: boolean | Code;
  fallbackUsesExtraFiles?: boolean;
  fallbackUsesAllVariants?: boolean;
  url: string;
  controlled?: boolean;
}

export interface CodeHighlighterClientProps extends CodeHighlighterBaseProps {
  children: React.ReactNode;
  errorHandler?: React.ReactNode;
  fallback?: React.ReactNode;
  skipFallback?: boolean;
  /**
   * @default 'hydration'
   */
  highlightAt?: 'init' | 'hydration' | 'idle';
}

export type LoadCodeMeta = (url: string) => Promise<Code>;
export type LoadVariantMeta = (variantName: string, url: string) => Promise<VariantCode>;
export type LoadSource = (url: string) => Promise<{
  source: string;
  extraFiles?: VariantExtraFiles;
  extraDependencies?: string[];
}>;
export type TransformSource = (
  source: string,
  fileName: string,
) => Promise<Record<string, { source: string; fileName?: string }> | undefined>;
export type ParseSource = (source: string, fileName: string) => HastNodes;

export type SourceTransformer = {
  extensions: string[];
  transformer: TransformSource;
};
export type SourceTransformers = Array<SourceTransformer>;

/**
 * Options for controlling file loading behavior
 */
export interface LoadFileOptions {
  /** Disable applying source transformers */
  disableTransforms?: boolean;
  /** Disable parsing source strings to AST */
  disableParsing?: boolean;
  /** Maximum recursion depth for loading nested extra files */
  maxDepth?: number;
  /** Set of already loaded file URLs to prevent circular dependencies */
  loadedFiles?: Set<string>;
}

export interface CodeHighlighterProps extends CodeHighlighterBaseProps {
  Content: React.ComponentType<ContentProps>;
  ErrorHandler?: ErrorHandler;
  ContentLoading?: React.ComponentType<ContentLoadingProps>;
  /**
   * @default 'stream'
   */
  highlightAt?: 'init' | 'stream' | 'hydration' | 'idle';
  forceClient?: boolean;
  loadCodeMeta?: LoadCodeMeta;
  loadVariantMeta?: LoadVariantMeta;
  loadSource?: LoadSource;
  sourceTransformers?: SourceTransformers;
  sourceParser?: Promise<ParseSource>;
}
