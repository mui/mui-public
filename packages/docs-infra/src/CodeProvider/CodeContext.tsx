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
import type { ParseSourceAsync } from './createParseSourceWorkerClient';
import type { PreParsedCacheEntry } from '../CodeHighlighter/CodeHighlighterContext';
import type { CodeEditorLoader } from '../useCode/codeEditorCache';
import type { CreateTransformedFiles } from '../useCode/TransformEngine';

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
  preParsedCache?: Map<string, PreParsedCacheEntry>,
) => Code;

export type ComputeHastDeltasFn = (parsedCode: Code, parseSource: ParseSource) => Promise<Code>;

// Lazy accessors for the heaviest functions. Each returns the function via a
// dynamic import (deduped per page by `PreloadProvider`), so the function's
// module - and its heavy transitive deps (e.g. jsondiffpatch) - stays out of
// the initial client bundle. The accessor's *presence* (always defined when a
// CodeProvider is mounted) is the synchronously-known "is provisioned" signal
// that gates loading, replacing the previous "is the resolved fn present" check.
export type LoadFallbackCodeLoader = () => Promise<LoadFallbackCodeFn>;
export type LoadVariantLoader = () => Promise<LoadVariantFn>;
export type ComputeHastDeltasLoader = () => Promise<ComputeHastDeltasFn>;
export type TransformEngineLoader = () => Promise<CreateTransformedFiles>;

/**
 * Context interface for code processing functions.
 * Provides heavy functions via context that can't be serialized across the server-client boundary.
 */
export interface CodeContext {
  /** Async parser promise for initial loading */
  sourceParser?: Promise<ParseSource>;
  /** Sync parser available after initial load completes */
  parseSource?: ParseSource;
  /**
   * Worker-backed asynchronous parser used for non-blocking syntax
   * highlighting during live editing. Available in browser environments
   * after the worker has initialized.
   */
  parseSourceAsync?: ParseSourceAsync;
  /** Source transformers for code transformation (e.g., TypeScript to JavaScript) */
  sourceTransformers?: SourceTransformers;
  /**
   * Explicit source enhancers for modifying parsed HAST. When omitted, the
   * provider supplies the default emphasis enhancer (`enhanceCodeEmphasis`)
   * eagerly, since it powers the synchronous live-editing re-enhancement path.
   */
  sourceEnhancers?: SourceEnhancers;
  /** Function to load raw source code and dependencies */
  loadSource?: LoadSource;
  /** Function to load specific variant metadata */
  loadVariantMeta?: LoadVariantMeta;
  /** Function to load code metadata from a URL */
  loadCodeMeta?: LoadCodeMeta;
  /** Heavy function: Parses code strings into HAST nodes (kept eager - small, on the sync parse path) */
  parseCode?: ParseCodeFn;
  /** Heavy function: Parses controlled code for editable demos (kept eager - sync parse path) */
  parseControlledCode?: ParseControlledCodeFn;
  /**
   * Lazily creates the live-editing worker (off-main-thread highlighter) and
   * registers the given grammar scopes into it, so a read-only page never spins
   * up the worker. Called by `CodeHighlighter` on the editable signal with the
   * block's scopes. No-op during SSR or where `Worker` is unavailable.
   */
  ensureParseSourceWorker?: (scopes: string[]) => Promise<void>;

  // Lazy accessors for the heaviest functions (dynamic-import-backed, deduped).
  /** Lazily loads the fallback-code loader (transitively pulls the variant loader). */
  loadCodeFallbackLoader?: LoadFallbackCodeLoader;
  /** Lazily loads the variant loader. */
  loadIsomorphicCodeVariantLoader?: LoadVariantLoader;
  /** Lazily loads the transform-delta computer (pulls jsondiffpatch). */
  computeHastDeltasLoader?: ComputeHastDeltasLoader;
  /**
   * Lazily loads the client-side transform applier (`createTransformedFiles` —
   * the `applyCodeTransform` path, which pulls `jsondiffpatch`). `useTransformManagement`
   * consumes it (warm-cached so transform swaps stay synchronous once loaded);
   * `CodeHighlighter` preloads it when it detects a block has transforms, so a
   * block without transforms never pulls this chunk.
   */
  transformEngineLoader?: TransformEngineLoader;
  /** Lazily loads the textarea editor. Read-only blocks never call this loader. */
  codeEditorLoader?: CodeEditorLoader;
}

export const CodeContext = React.createContext<CodeContext>({});

export const useCodeContext = () => {
  const context = React.useContext(CodeContext);

  return context;
};
