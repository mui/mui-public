'use client';

import * as React from 'react';
import type {
  LoadCodeMeta,
  LoadSource,
  LoadVariantMeta,
  ParseSource,
  SourceTransformers,
  SourceEnhancers,
  Code,
  ControlledCode,
  LoadFallbackCodeOptions,
  LoadVariantOptions,
  Externals,
  VariantCode,
} from '../CodeHighlighter/types';

// Type definitions for the heavy functions we're moving to context
export type LoadFallbackCodeFn = (
  url: string,
  initialVariant: string,
  loaded: Code | undefined,
  options?: LoadFallbackCodeOptions,
) => Promise<{ code: Code; processedGlobalsCode?: Array<Code> }>;

export type LoadVariantFn = (
  url: string | undefined,
  variantName: string,
  variant: VariantCode | string | undefined,
  options?: LoadVariantOptions,
) => Promise<{ code: VariantCode; dependencies: string[]; externals: Externals }>;

export type ParseCodeFn = (code: Code, parseSource: ParseSource) => Code;

export type ParseControlledCodeFn = (
  controlledCode: ControlledCode,
  parseSource: ParseSource,
) => Code;

export type ComputeHastDeltasFn = (parsedCode: Code, parseSource: ParseSource) => Promise<Code>;

export type GetAvailableTransformsFn = (
  parsedCode: Code | undefined,
  variantName: string,
) => string[];

export interface CodeContext {
  sourceParser?: Promise<ParseSource>;
  parseSource?: ParseSource; // Sync version when available
  sourceTransformers?: SourceTransformers;
  sourceEnhancers?: SourceEnhancers;
  loadSource?: LoadSource;
  loadVariantMeta?: LoadVariantMeta;
  loadCodeMeta?: LoadCodeMeta;
  // Heavy functions moved from CodeHighlighterClient
  loadCodeFallback?: LoadFallbackCodeFn;
  loadCodeVariant?: LoadVariantFn;
  parseCode?: ParseCodeFn;
  parseControlledCode?: ParseControlledCodeFn;
  computeHastDeltas?: ComputeHastDeltasFn;
  getAvailableTransforms?: GetAvailableTransformsFn;
}

export const CodeContext = React.createContext<CodeContext>({});

export const useCodeContext = () => {
  const context = React.useContext(CodeContext);

  return context;
};
