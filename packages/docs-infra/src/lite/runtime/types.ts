import type * as React from 'react';

export interface VariantExtraFile {
  language: string;
  totalLines: number;
}

export type VariantExtraFiles = Record<string, VariantExtraFile>;

export interface VariantCode {
  fileName: string;
  exportName: string;
  html: string;
  language: string;
  totalLines: number;
  extraFiles?: VariantExtraFiles;
}

export interface CodePrecompute {
  variants: Record<string, VariantCode>;
  deferredUrl?: string;
}

export interface DeferredVariant {
  source?: string;
  extraFiles?: Record<string, string>;
}

export type DeferredSources = Record<string, DeferredVariant>;

export type ContentProps<T extends object = {}> = T & {
  name: string;
  slug: string;
  url: string;
  code: CodePrecompute;
  components: Record<string, React.ReactNode>;
};

export interface CodeHighlighterProps<T extends object = {}> {
  name: string;
  slug: string;
  url: string;
  precompute: CodePrecompute;
  components: Record<string, React.ReactNode>;
  Content: React.ComponentType<ContentProps<T>>;
  contentProps?: T;
}
