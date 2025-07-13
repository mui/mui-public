import type { Nodes as HastNodes } from 'hast';
import type { Delta } from 'jsondiffpatch';

export type Components = { [key: string]: React.ReactNode };

type CodeMeta = {
  fileName: string;
};

export type Transforms = Record<string, { delta: Delta; fileName?: string }>;

export type VariantSource = string | HastNodes | { hastJson: string };
export type VariantExtraFiles = {
  [fileName: string]: null | (CodeMeta & { source?: VariantSource });
};
export type VariantCode = CodeMeta & {
  source?: VariantSource;
  extraFiles?: VariantExtraFiles;
  filesOrder?: string[];
  transforms?: Transforms;
};
export type Code = { [key: string]: VariantCode }; // TODO: only preload should be able to pass highlighted code

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
  url?: string;
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

export type LoadVariantCode = (variantName: string, url?: string) => Promise<VariantCode>;
export type LoadSource = (variantName: string, fileName: string, url?: string) => Promise<string>;
export type TransformSource = (
  source: string,
  fileName: string,
) => Promise<Record<string, { source: string; fileName?: string }> | undefined>;
export type ParseSource = (source: string, fileName: string) => Promise<HastNodes>;

export type SourceTransformers = Array<{
  extensions: string[];
  transformer: TransformSource;
}>;

export interface CodeHighlighterProps extends CodeHighlighterBaseProps {
  Content: React.ComponentType<ContentProps>;
  ErrorHandler?: ErrorHandler;
  ContentLoading?: React.ComponentType<ContentLoadingProps>;
  /**
   * @default 'stream'
   */
  highlightAt?: 'init' | 'stream' | 'hydration' | 'idle';
  forceClient?: boolean;
  loadVariantCode?: LoadVariantCode;
  loadSource?: LoadSource;
  sourceTransformers?: SourceTransformers;
  parseSource?: ParseSource;
}
