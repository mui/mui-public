import type { CompressedFallback } from './fallbackFormat';
import type { Code, Components } from './types';

/**
 * Props for the client-side CodeHighlighter component.
 * Used when rendering happens in the browser with lazy loading and interactive features.
 *
 * Internal: the prop shape of the (non-exported) `CodeHighlighterClient`. Inlined
 * here rather than composed from the shared prop-group types so it stays out of
 * the public `CodeHighlighter/types` surface.
 */
export interface CodeHighlighterClientProps {
  /** Display name for the code example, used for identification and titles */
  name?: string;
  /** URL-friendly identifier for deep linking and navigation */
  slug?: string;
  /** Source URL where the code content originates from */
  url?: string;
  /** Static code content with variants and metadata */
  code?: Code;
  /** React components for live preview alongside code */
  components?: Components;
  /** What type of variants are available (e.g., a type `packageManager` when variants `npm` and `yarn` are available) */
  variantType?: string;
  /** Static variant names that should be fetched at runtime */
  variants?: string[];
  /** Currently selected variant name */
  variant?: string;
  /** Currently selected file name */
  fileName?: string;
  /** Language for syntax highlighting (e.g., 'tsx', 'css'). When provided, fileName is not required for parsing. */
  language?: string;
  /** Default variant to show on first load */
  initialVariant?: string;
  /** Fallback variant when the requested variant is not available */
  defaultVariant?: string;
  /** Global static code snippets to inject, typically for styling or tooling */
  globalsCode?: Array<Code | string>;
  /** Pre-computed code data from build-time optimization */
  precompute?: Code;
  /** Whether fallback content should include extra files */
  fallbackUsesExtraFiles?: boolean;
  /** Whether fallback content should include all variants */
  fallbackUsesAllVariants?: boolean;
  /**
   * Paint only the collapsed window in the `ContentLoading` fallback and defer
   * each file's full fallback into the compressed payload. Shrinks the initial
   * HTML of a collapsed block to its on-screen lines, but removes the hidden
   * lines from the server-rendered markup — so it is **only** appropriate for
   * content that will not be crawled (authenticated or internal pages). See the
   * prop-compression pattern's "Splitting the Fallback by Visibility".
   * @default false
   */
  fallbackCollapsed?: boolean;
  /** Enable controlled mode for external code state management */
  controlled?: boolean;
  /**
   * When the live-editing engine loads for an editable block:
   *   - `'eager'` (default): load it as soon as the block is editable, and let
   *     `CodeHighlighter` speculatively preload it on first render.
   *   - `'interaction'`: defer the load until the reader hovers, focuses, or
   *     clicks the code, and suppress the speculative preload — so a block the
   *     reader never engages does not fetch the engine chunk at all.
   *
   * Only meaningful for editable blocks (a `CodeControllerContext` exposing
   * `setCode`); ignored otherwise.
   * @default 'eager'
   */
  editActivation?: 'eager' | 'interaction';
  /** Force client-side rendering even when server rendering is available */
  forceClient?: boolean;
  /** Defer parsing and populating the AST into memory until the code is enhanced
   * Applies only in production when RSC loading
   * @default 'gzip'
   */
  deferParsing?: 'none' | 'json' | 'gzip';
  /** The CodeContent component that renders the code display and syntax highlighting */
  children: React.ReactNode;
  /** Loading placeholder shown while code is being processed */
  fallback?: React.ReactNode;
  /** Skip showing fallback content entirely */
  skipFallback?: boolean;
  /**
   * When to perform syntax highlighting for performance optimization
   * @default 'hydration'
   */
  highlightAfter?: 'init' | 'hydration' | 'idle';
  enhanceAfter?: 'init' | 'hydration' | 'idle';
  /**
   * The variant/file fallbacks a `ContentLoading` component never renders,
   * consolidated into a single DEFLATE blob (see `compressResidualFallbacks`).
   * The rendered subset crosses plain on `ContentLoading` props; this carries
   * everything else compressed. Decompressed once on the client — using the
   * hoisted rendered text as its preset dictionary — and scattered back onto
   * `Code` before the content decodes. Absent when there is no residual worth
   * compressing.
   */
  residualFallbacks?: CompressedFallback;
}
