import type { Nodes as HastNodes } from 'hast';

export type Components = { [key: string]: React.ReactNode };

type CodeMeta = {
  fileName: string;
};

export type VariantSource = string | HastNodes | { hastJson: string };
export type VariantExtraFiles = {
  [fileName: string]: null | (CodeMeta & { source?: VariantSource });
};
export type VariantCode = CodeMeta & {
  source?: VariantSource;
  extraFiles?: VariantExtraFiles;
};
export type Code = { [key: string]: VariantCode };

type ParsedVariantCode = CodeMeta & {
  source: HastNodes | { hastJson: string };
  extraFiles: { [fileName: string]: CodeMeta & { source: HastNodes | { hastJson: string } } };
};
type ParsedCode = { [key: string]: ParsedVariantCode };

type Options = { name?: string; slug?: string; description?: string };
export type ContentProps = { code: ParsedCode; components?: Components } & Options;
export type ContentLoadingProps = { fileNames: string[]; source: React.ReactNode };

type ErrorHandler = React.ComponentType<{ error: Error }>;

interface CodeHighlighterBaseProps extends Options {
  Content: React.ComponentType<ContentProps>;
  code?: Code;
  components?: Components;
  variant?: string;
  initialVariant?: string;
  defaultVariant?: string;
  precompute?: boolean | Code;
  ErrorHandler?: ErrorHandler;
  ContentLoading?: React.ComponentType<ContentLoadingProps>;
  fallbackUsesExtraFiles?: boolean;
  fallbackUsesAllVariants?: boolean;
  url?: string;
}

export type Fallback = React.ReactNode;

export interface CodeHighlighterClientProps extends CodeHighlighterBaseProps {
  highlightAt?: 'init' | 'hydration' | 'idle';
  fallback?: Fallback;
}

export type LoadVariantCode = (variantName: string, url?: string) => Promise<VariantCode>;
export type LoadSource = (variantName: string, fileName: string, url?: string) => Promise<string>;
export type ParseSource = (source: string) => Promise<HastNodes>;

export interface CodeHighlighterProps extends CodeHighlighterBaseProps {
  highlightAt?: 'init' | 'stream' | 'hydration' | 'idle';
  clientOnly?: boolean;
  loadVariantCode?: LoadVariantCode;
  loadSource?: LoadSource;
  parseSource?: ParseSource;
}
