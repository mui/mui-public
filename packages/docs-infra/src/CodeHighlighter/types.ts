import type { Root, RootData } from 'hast';
import type { Delta } from 'jsondiffpatch';

export type Components = { [key: string]: React.ReactNode };

type CodeMeta = {
  /** Name of the file (e.g., 'Button.tsx') */
  fileName?: string;
  /** Language for syntax highlighting (e.g., 'tsx', 'css'). When provided, fileName is not required. */
  language?: string;
  /** Flattened path for the file */
  path?: string;
};

export type Transforms = Record<string, { delta: Delta; fileName?: string }>;

// External import definition matching parseImportsAndComments.ts
export interface ExternalImportItem {
  name: string;
  type: 'named' | 'default' | 'namespace';
  isType?: boolean;
}

export type Externals = Record<string, ExternalImportItem[]>;

export interface HastRoot extends Root {
  data?: RootData & { totalLines?: number };
}

export type VariantSource = string | HastRoot | { hastJson: string } | { hastGzip: string };

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

/**
 * Base props passed to Content components for rendering code examples.
 * These props provide the necessary data for displaying code, previews, and metadata.
 */
type BaseContentProps = CodeIdentityProps &
  Pick<CodeContentProps, 'code' | 'components' | 'variantType'>;

export type ContentProps<T extends {}> = BaseContentProps & T;
export type ContentLoadingVariant = {
  fileNames?: string[];
  source?: React.ReactNode;
  extraSource?: { [fileName: string]: React.ReactNode };
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
  };

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
export type ParseSource = (source: string, fileName: string, language?: string) => HastRoot;

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
  /** Output format for the loaded file
   * @default 'hast'
   */
  output?: 'hast' | 'hastJson' | 'hastGzip';
}

/**
 * Options for the loadCodeVariant function, extending LoadFileOptions with required function dependencies
 */
export interface LoadVariantOptions
  extends
    LoadFileOptions,
    Pick<
      CodeFunctionProps,
      'sourceParser' | 'loadSource' | 'loadVariantMeta' | 'sourceTransformers'
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
