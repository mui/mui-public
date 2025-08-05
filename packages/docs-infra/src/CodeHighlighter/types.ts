import type { Nodes as HastNodes } from 'hast';
import type { Delta } from 'jsondiffpatch';

export type Components = { [key: string]: React.ReactNode };

type CodeMeta = {
  fileName?: string;
};

export type Transforms = Record<string, { delta: Delta; fileName?: string }>;

// External import definition matching parseImports.ts
export interface ExternalImportItem {
  name: string;
  type: 'named' | 'default' | 'namespace';
  isType?: boolean;
}

export type Externals = Record<string, ExternalImportItem[]>;

export type VariantSource = string | HastNodes | { hastJson: string };
export type VariantExtraFiles = {
  [fileName: string]:
    | string
    | {
        source?: VariantSource;
        transforms?: Transforms;
        skipTransforms?: boolean;
        metadata?: boolean;
      };
};
export type VariantCode = CodeMeta & {
  url?: string;
  source?: VariantSource;
  extraFiles?: VariantExtraFiles;
  externals?: string[];
  namedExport?: string;
  filesOrder?: string[];
  transforms?: Transforms;
  allFilesListed?: boolean;
  skipTransforms?: boolean;
};
export type Code = { [key: string]: undefined | string | VariantCode }; // TODO: only preload should be able to pass highlighted code

export type ControlledVariantExtraFiles = {
  [fileName: string]: { source: string | null };
};
export type ControlledVariantCode = CodeMeta & {
  url?: string;
  source?: string | null;
  extraFiles?: ControlledVariantExtraFiles;
  filesOrder?: string[];
};
export type ControlledCode = { [key: string]: undefined | null | ControlledVariantCode };

type BaseContentProps = {
  name?: string;
  slug?: string;
  code?: Code;
  components?: Components;
  url?: string;
};

export type ContentProps<T extends {}> = BaseContentProps & T;
export type ContentLoadingVariant = {
  fileNames?: string[];
  source?: React.ReactNode;
  extraSource?: { [fileName: string]: React.ReactNode };
};
export type BaseContentLoadingProps = ContentLoadingVariant & {
  extraVariants?: Record<string, ContentLoadingVariant>;
  name?: string;
  slug?: string;
  url?: string;
};
export type ContentLoadingProps<T extends {}> = BaseContentLoadingProps & T;

type ErrorHandler = React.ComponentType<{ error: Error }>;

interface CodeHighlighterBaseProps {
  name?: string;
  slug?: string;
  code?: Code;
  globalsCode?: Array<Code | string>;
  components?: Components; // TODO: rename to preview
  variants?: string[];
  variant?: string;
  fileName?: string;
  initialVariant?: string;
  defaultVariant?: string;
  precompute?: Code;
  fallbackUsesExtraFiles?: boolean;
  fallbackUsesAllVariants?: boolean;
  url?: string;
  controlled?: boolean;
  children?: string;
}

export interface CodeHighlighterClientProps extends Omit<CodeHighlighterBaseProps, 'children'> {
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
  externals?: Externals;
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
  /** Side effects code to inject into extraFiles */
  globalsCode?: Array<VariantCode | string>;
}

export interface CodeHighlighterProps<T extends {}> extends CodeHighlighterBaseProps {
  Content: React.ComponentType<ContentProps<T>>;
  contentProps?: T;
  ErrorHandler?: ErrorHandler;
  ContentLoading?: React.ComponentType<ContentLoadingProps<T>>;
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
