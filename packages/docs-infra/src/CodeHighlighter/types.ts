import type { Root, RootData } from 'hast';
import type { Delta } from 'jsondiffpatch';
import type { FallbackNode } from './fallbackFormat';

export type Components = { [key: string]: React.ReactNode };

type CodeMeta = {
  /** Name of the file (e.g., 'Button.tsx') */
  fileName?: string;
  /** Language for syntax highlighting (e.g., 'tsx', 'css'). When provided, fileName is not required. */
  language?: string;
  /** Flattened path for the file */
  path?: string;
};

/**
 * Records the transforms available for a source. Each entry can provide a
 * jsondiffpatch `delta` (the patch to apply against the source's parsed hast
 * tree), an optional renamed `fileName`, and an optional `comments` map.
 *
 * When `comments` is present, it represents the post-transform comment map
 * (1-indexed by line number in the transformed source) and is used as-is by
 * `applyCodeTransformWithComments` instead of auto-shifting the caller's
 * comments via the surviving `dataLn` mapping. Source transformers should
 * only emit `comments` when they add or relocate lines; transforms that only
 * wipe lines (replacing them with empty strings) are handled automatically.
 *
 * `hasDelta` indicates whether the entry actually produced a code-level
 * difference. When `false` (or omitted), the entry is rename-only — it
 * carries a renamed `fileName` (and optionally `comments`) but the
 * transformed source is structurally identical to the original. Rename-only
 * entries are excluded from `getAvailableTransforms` (so the toggle stays
 * hidden when nothing meaningful changes) but still apply the rename when
 * the user has the matching transform preference selected.
 *
 * `hasCollapse` indicates whether the inline `delta` (or the embedded delta
 * matching this manifest entry) inserts a `.collapse` placeholder element.
 * The runtime uses this flag to classify a transform swap as
 * layout-affecting (phase 1: coordinated barrier so peers stay in lockstep)
 * versus non-layout (phase 2: deferred until after phase 1 settles) without
 * having to decompress the embedded hast payload on every selection
 * change. Computed once during `splitTransformsForEmbed` and persisted on
 * the manifest entry.
 *
 * `hasCollapseInFocus` is the focus-region-aware counterpart: it is `true`
 * only when at least one `.collapse` placeholder lands inside the source
 * region that is visible when the surrounding code block is *collapsed*
 * (the lines covered by `data-frame-type` ∈ `'highlighted' | 'focus' |
 * 'padding-top' | 'padding-bottom'`, falling back to the first frame when
 * no emphasis frames exist — matching the runtime visibility rule in
 * `<Pre>`). Consumers that opt into `transformLayoutShift: 'focus'` use
 * this flag (instead of `hasCollapse`) while the block is collapsed, so a
 * `.collapse` insertion outside the visible window doesn't force a
 * coordinated barrier swap that the user wouldn't see anyway.
 *
 * After serialization (`output: 'hastJson' | 'hastCompressed'`), the deltas
 * are moved inside the source's `HastRoot.data.transforms` so they ride
 * along inside the compressed payload and never appear as plain JSON in the
 * rendered HTML or in the demo module graph. In that mode the variant-level
 * `transforms` field acts as a manifest — entries keep `fileName`,
 * `comments` (when set), `hasDelta`, `hasCollapse`, and
 * `hasCollapseInFocus` but `delta` is omitted. Consumers that need the
 * delta should look it up inside the decompressed `root.data.transforms`.
 */
export type Transforms = Record<
  string,
  {
    delta?: Delta;
    fileName?: string;
    comments?: SourceComments;
    hasDelta?: boolean;
    hasCollapse?: boolean;
    hasCollapseInFocus?: boolean;
  }
>;

// External import definition matching parseImportsAndComments.ts
export interface ExternalImportItem {
  name: string;
  type: 'named' | 'default' | 'namespace';
  isType?: boolean;
}

export type Externals = Record<string, ExternalImportItem[]>;

export interface HastRoot extends Root {
  data?: RootData & {
    totalLines?: number;
    /**
     * Number of source lines visible inside the focused window when the code
     * block is collapsed — the sum of frame sizes whose `data-frame-type` is
     * `'highlighted'`, `'focus'`, `'padding-top'`, or `'padding-bottom'`.
     * Equals `totalLines` when no emphasis directives are present (the whole
     * source is the focused window). Set by `enhanceCodeEmphasis`.
     */
    focusedLines?: number;
    collapsible?: boolean;
    frameSize?: number;
    appliedEnhancers?: string[];
    /**
     * Transform deltas embedded in the hast root so they get compressed along
     * with the tree and stay out of the rendered HTML / module graph. The
     * variant-level `transforms` field is a `TransformManifest` (keys only)
     * that mirrors `Object.keys(this.transforms)`. `hast-util-to-jsx-runtime`
     * does not serialize `Root.data` to the DOM.
     */
    transforms?: Transforms;
  };
}

export type VariantSource = string | HastRoot | { hastJson: string } | { hastCompressed: string };

/**
 * Additional files associated with a code variant.
 * Can be either simple string content or objects with source and transformation options.
 */
export type VariantExtraFiles = {
  [fileName: string]:
    | string
    | {
        /** Source content for this file */
        source?: VariantSource;
        /**
         * Compact fallback for this extra file.
         * See `VariantCode.fallback` for details.
         */
        fallback?: FallbackNode[];
        /** Language for syntax highlighting (e.g., 'tsx', 'css'). Derived from fileName extension if not provided. */
        language?: string;
        /** Transformations that can be applied to this file */
        transforms?: Transforms;
        /** Skip generating source transformers for this file */
        skipTransforms?: boolean;
        /** Include metadata for this file */
        metadata?: boolean;
        /** File system path for this file */
        path?: string;
        /**
         * Path of this file relative to the variant's `url`. Set when the
         * `extraFiles` key was rewritten (e.g., flattened) and no longer
         * resolves to the file's URL on its own. Consumers derive the file
         * URL via `new URL(relativeUrl, variant.url)`. When omitted, the
         * `extraFiles` key itself resolves to the file URL against
         * `variant.url`.
         *
         * Always normalized to start with `./` or `../`.
         */
        relativeUrl?: string;
        /** Comments extracted from source, stored when parsing is disabled for later use */
        comments?: SourceComments;
      };
};

/**
 * Complete code variant definition with source, metadata, and configuration.
 * Extends CodeMeta with all the information needed to display and process a code example.
 */
export type VariantCode = CodeMeta & {
  /** Source URL where this variant originates */
  url?: string;
  /** Main source content for this variant */
  source?: VariantSource;
  /**
   * Compact fallback (highlighting spans removed) for the main source.
   * Converted from HAST via `hastToFallback` for smaller RSC payloads.
   * Used as the visual fallback before full highlighting loads, and its text
   * content (via `fallbackToText`) serves as the DEFLATE dictionary for
   * decompressing `hastCompressed` payloads.
   */
  fallback?: FallbackNode[];
  /** Additional files associated with this variant */
  extraFiles?: VariantExtraFiles;
  /** Prefix for metadata keys, e.g. /src */
  metadataPrefix?: string;
  /** External module dependencies */
  externals?: string[];
  /** The name of the export for this variant's entrypoint */
  namedExport?: string;
  /** Order in which files should be displayed */
  filesOrder?: string[];
  /** Transformations that can be applied to the source */
  transforms?: Transforms;
  /** Whether all files in the variant are explicitly listed */
  allFilesListed?: boolean;
  /** Skip generating source transformers for this variant */
  skipTransforms?: boolean;
  /** Comments extracted from source, stored when parsing is disabled for later use */
  comments?: SourceComments;
};

export type Code = { [key: string]: undefined | string | VariantCode }; // TODO: only preload should be able to pass highlighted code

/**
 * Tracks comments that were collapsed onto a line when their original lines
 * were deleted. Keyed by the line they collapsed onto; each entry records
 * the original offset from the edit line so the collapse can be reversed.
 */
export type CollapseMap = Record<number, Array<{ offset: number; comments: string[] }>>;

export type ControlledVariantExtraFiles = {
  [fileName: string]: {
    source: string | null;
    comments?: SourceComments;
    collapseMap?: CollapseMap;
    totalLines?: number;
    emptyLines?: number[];
  };
};
export type ControlledVariantCode = CodeMeta & {
  url?: string;
  source?: string | null;
  extraFiles?: ControlledVariantExtraFiles;
  filesOrder?: string[];
  comments?: SourceComments;
  collapseMap?: CollapseMap;
  totalLines?: number;
  emptyLines?: number[];
};
export type ControlledCode = { [key: string]: undefined | null | ControlledVariantCode };

/**
 * Base props passed to Content components for rendering code examples.
 * These props provide the necessary data for displaying code, previews, and metadata.
 */
type BaseContentProps = CodeIdentityProps &
  Pick<CodeContentProps, 'code' | 'components' | 'variantType'>;

export type ContentProps<T extends {}> = BaseContentProps & T;
/**
 * Record of `fileName → compact fallback` extracted from variants.
 * Used as the DEFLATE dictionary for `hastCompressed` decompression and
 * as the visual fallback before full highlighting loads.
 */
export type Fallbacks = Record<string, FallbackNode[]>;

export type ContentLoadingVariant = {
  fileNames?: string[];
  source?: FallbackNode[];
  /**
   * Language hint for the rendered `source` (e.g. `'tsx'`, `'css'`). Derived
   * from the variant's explicit `language` when set, otherwise from the
   * selected file name's extension. Consumers typically forward this as a
   * `language-{language}` class on the fallback `<code>` element so it picks
   * up the same language-scoped styling as the post-load tree.
   */
  language?: string;
  extraSource?: Record<string, FallbackNode[]>;
};
export type BaseContentLoadingProps = ContentLoadingVariant &
  CodeIdentityProps & {
    extraVariants?: Record<string, ContentLoadingVariant>;
  };
export type ContentLoadingProps<T extends {}> = BaseContentLoadingProps &
  T & {
    component: React.ReactNode;
    components?: Record<string, React.ReactNode>;
    initialFilename?: string;
    /**
     * Name of the variant currently selected for the fallback render — the
     * same key passed to `codeToFallbackProps` and used to look up
     * `component` / `components`. Consumers use this when labeling the main
     * variant in the fallback UI or when generating per-file slugs.
     */
    initialVariant?: string;
  };

export type LoadCodeMeta = (url: string) => Promise<Code>;
export type LoadVariantMeta = (variantName: string, url: string) => Promise<VariantCode>;
export type LoadSource = (url: string) => Promise<{
  source: string;
  extraFiles?: VariantExtraFiles;
  extraDependencies?: string[];
  externals?: Externals;
  /** Comments extracted from the source code, keyed by line number */
  comments?: SourceComments;
}>;
/**
 * Function that transforms a source file into one or more derived sources.
 *
 * @param source - The source code string to transform.
 * @param fileName - File name (used for extension detection / diagnostics).
 * @param comments - Optional comment map for `source`, keyed by 0-indexed
 *   line number (matching `source.split('\n')`). Transformers that want to
 *   shift comments manually should return a `comments` map alongside each
 *   transformed source, using the same 0-indexed line scheme relative to
 *   the returned source string.
 * @returns A record keyed by transform name. Each entry must contain the
 *   transformed `source` string, optionally a renamed `fileName`, and
 *   optionally a `comments` map. The runtime applies `comments` verbatim
 *   when present (after converting to 1-indexed); when omitted, surviving
 *   lines' comments are shifted automatically based on which source lines
 *   survived the transform.
 *
 *   Transformers that only **remove** lines should replace those lines with
 *   empty strings rather than dropping them — the empty lines collapse
 *   automatically at runtime and the auto-shift correctly maps the
 *   surviving lines' comments. Only transformers that **add lines** or
 *   completely replace the file need to return an explicit `comments` map.
 */
export type TransformSource = (
  source: string,
  fileName: string,
  comments?: SourceComments,
) => Promise<
  Record<string, { source: string; fileName?: string; comments?: SourceComments }> | undefined
>;

/**
 * Parses source code into a HAST tree with syntax highlighting.
 *
 * @param source - The source code to parse and highlight
 * @param fileName - File name used to detect language via file extension
 * @param language - Optional explicit language override (e.g., 'tsx', 'css', 'typescript')
 */
export type ParseSource = (source: string, fileName: string, language?: string) => HastRoot;

export type SourceTransformer = {
  extensions: string[];
  transformer: TransformSource;
};
export type SourceTransformers = Array<SourceTransformer>;

/**
 * Comments extracted from source code, keyed by line number.
 * Each line number maps to an array of comment strings found on that line.
 */
export type SourceComments = Record<number, string[]>;

/**
 * Function that enhances a HAST root node, optionally using source comments for context.
 * Enhancers run after parsing and before transforms are computed.
 *
 * @param root - The HAST root node to enhance
 * @param comments - Comments extracted from the source code, keyed by line number
 * @param fileName - The name of the file being processed
 * @returns The enhanced HAST root node (can be the same object, mutated)
 */
export interface SourceEnhancer {
  (
    root: HastRoot,
    comments: SourceComments | undefined,
    fileName: string,
  ): HastRoot | Promise<HastRoot>;
  /**
   * Stable identifier for this enhancer. When set, the enhancer is recorded on
   * the HAST root as `data.appliedEnhancers` after it runs, and subsequent
   * passes (e.g. on the client after a server-side run) skip it instead of
   * re-applying. Anonymous enhancers always run.
   */
  enhancerName?: string;
}

/**
 * Array of source enhancer functions that run in order after parsing.
 */
export type SourceEnhancers = Array<SourceEnhancer>;

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
  /** Output format for the loaded file
   * @default 'hast'
   */
  output?: 'hast' | 'hastJson' | 'hastCompressed';
  /**
   * Optional URL-prefix rewrite applied to the loaded variant's `url` and any
   * string-form `extraFiles` entries. Useful for translating local `file://`
   * URLs (e.g. those returned by `loadServerCodeSource`) into hosted URLs (e.g.
   * `https://github.com/owner/repo/tree/<branch>/`) before they reach the
   * client.
   */
  urlPrefix?: { from: string; to: string };
}

/**
 * Options for the loadIsomorphicCodeVariant function, extending LoadFileOptions with required function dependencies
 */
export interface LoadVariantOptions
  extends
    LoadFileOptions,
    Pick<
      CodeFunctionProps,
      'sourceParser' | 'loadSource' | 'loadVariantMeta' | 'sourceTransformers' | 'sourceEnhancers'
    > {}

/**
 * Options for loading fallback code with various configuration flags
 */
export interface LoadFallbackCodeOptions
  extends
    LoadFileOptions,
    CodeFunctionProps,
    Pick<CodeContentProps, 'variants'>,
    Pick<CodeLoadingProps, 'fallbackUsesExtraFiles' | 'fallbackUsesAllVariants'> {
  /** Flag to indicate if syntax highlighting should be performed */
  shouldHighlight?: boolean;
  /** Specific filename to initially display */
  initialFilename?: string;
  /** Array of global code to include (overrides LoadFileOptions.globalsCode with different type) */
  globalsCode?: Array<Code | string>;
}

/**
 * Basic identification and metadata props for code examples
 */
export interface CodeIdentityProps {
  /** Display name for the code example, used for identification and titles */
  name?: string;
  /** URL-friendly identifier for deep linking and navigation */
  slug?: string;
  /** Source URL where the code content originates from */
  url?: string;
}

/**
 * Core code content and variant management props
 */
export interface CodeContentProps {
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
}

/**
 * Loading and processing configuration props
 */
export interface CodeLoadingProps {
  /** Pre-computed code data from build-time optimization */
  precompute?: Code;
  /** Whether fallback content should include extra files */
  fallbackUsesExtraFiles?: boolean;
  /** Whether fallback content should include all variants */
  fallbackUsesAllVariants?: boolean;
  /** Enable controlled mode for external code state management */
  controlled?: boolean;
  /** Raw code string for simple use cases */
  children?: string;
  /**
   * When to perform syntax highlighting and code processing
   * @default 'idle'
   */
  highlightAfter?: 'init' | 'stream' | 'hydration' | 'idle';
  /**
   * When to enhance the code display with interactivity
   * @default 'idle'
   */
  enhanceAfter?: 'init' | 'stream' | 'hydration' | 'idle';
  /** Force client-side rendering even when server rendering is available */
  forceClient?: boolean;
  /** Defer parsing and populating the AST into memory until the code is enhanced
   * Applies only in production when RSC loading
   * @default 'gzip'
   */
  deferParsing?: 'none' | 'json' | 'gzip';
}

/**
 * Function props for loading and transforming code
 */
export interface CodeFunctionProps {
  /** Function to load code metadata from a URL */
  loadCodeMeta?: LoadCodeMeta;
  /** Function to load specific variant metadata */
  loadVariantMeta?: LoadVariantMeta;
  /** Function to load raw source code and dependencies */
  loadSource?: LoadSource;
  /** Array of source transformers for code processing (e.g., TypeScript to JavaScript) */
  sourceTransformers?: SourceTransformers;
  /** Promise resolving to a source parser for syntax highlighting */
  sourceParser?: Promise<ParseSource>;
  /** Array of source enhancers that run after parsing to enhance the HAST tree */
  sourceEnhancers?: SourceEnhancers;
  /**
   * Optional URL-prefix rewrite forwarded to {@link LoadFileOptions.urlPrefix}.
   * Lets the demo factory translate local `file://` URLs returned by
   * `loadSource` into hosted URLs before they reach the client.
   */
  urlPrefix?: { from: string; to: string };
}

/**
 * Component and rendering props
 */
export interface CodeRenderingProps<T extends {}> {
  /** Component to render the code content and preview */
  Content: React.ComponentType<ContentProps<T>>;
  /** Additional props passed to the Content component */
  contentProps?: T;
}

/**
 * Client-specific rendering props
 */
export interface CodeClientRenderingProps {
  /** The CodeContent component that renders the code display and syntax highlighting */
  children: React.ReactNode;
  /** Loading placeholder shown while code is being processed */
  fallback?: React.ReactNode;
  /** Skip showing fallback content entirely */
  skipFallback?: boolean;
}

/**
 * Base props containing essential properties shared across CodeHighlighter components and helper functions.
 * This serves as the foundation for other CodeHighlighter-related interfaces.
 */
export interface CodeHighlighterBaseProps<T extends {}>
  extends
    CodeIdentityProps,
    CodeContentProps,
    CodeLoadingProps,
    CodeFunctionProps,
    CodeRenderingProps<T> {}

/**
 * Props for the client-side CodeHighlighter component.
 * Used when rendering happens in the browser with lazy loading and interactive features.
 */
export interface CodeHighlighterClientProps
  extends
    CodeIdentityProps,
    CodeContentProps,
    Omit<CodeLoadingProps, 'children'>,
    CodeClientRenderingProps {
  /**
   * When to perform syntax highlighting for performance optimization
   * @default 'hydration'
   */
  highlightAfter?: 'init' | 'hydration' | 'idle';
  enhanceAfter?: 'init' | 'hydration' | 'idle';
}

/**
 * Main props for the CodeHighlighter component.
 * Supports both build-time precomputation and runtime code loading with extensive customization options.
 * Generic type T allows for custom props to be passed to Content and ContentLoading components.
 */
export interface CodeHighlighterProps<T extends {}> extends CodeHighlighterBaseProps<T> {
  /** Component to show while code is being loaded or processed */
  ContentLoading?: React.ComponentType<ContentLoadingProps<T>>;
}
