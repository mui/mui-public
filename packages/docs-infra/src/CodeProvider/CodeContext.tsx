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

/**
 * Context interface for code processing functions.
 * Provides heavy functions via context that can't be serialized across the server-client boundary.
 */
export interface CodeContext {
  /** Async parser promise for initial loading */
  sourceParser?: Promise<ParseSource>;
  /** Sync parser available after initial load completes */
  parseSource?: ParseSource;
  /** Source transformers for code transformation (e.g., TypeScript to JavaScript) */
  sourceTransformers?: SourceTransformers;
  /** Source enhancers for modifying parsed HAST */
  sourceEnhancers?: SourceEnhancers;
  /** Function to load raw source code and dependencies */
  loadSource?: LoadSource;
  /** Function to load specific variant metadata */
  loadVariantMeta?: LoadVariantMeta;
  /** Function to load code metadata from a URL */
  loadCodeMeta?: LoadCodeMeta;
  /** Heavy function: Loads fallback code with all variants and files */
  loadCodeFallback?: LoadFallbackCodeFn;
  /** Heavy function: Loads a specific code variant with its dependencies */
  loadCodeVariant?: LoadVariantFn;
  /** Heavy function: Parses code strings into HAST nodes */
  parseCode?: ParseCodeFn;
  /** Heavy function: Parses controlled code for editable demos */
  parseControlledCode?: ParseControlledCodeFn;
  /** Heavy function: Computes HAST deltas for code transformations */
  computeHastDeltas?: ComputeHastDeltasFn;
  /** Heavy function: Gets available transform keys for a variant */
  getAvailableTransforms?: GetAvailableTransformsFn;
}

export const CodeContext = React.createContext<CodeContext>({});

export const useCodeContext = () => {
  const context = React.useContext(CodeContext);

  return context;
};
