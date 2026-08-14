import type {
  Code,
  Externals,
  LoadSource,
  ParseSource,
  SourceEnhancers,
  SourceTransformers,
} from '../../CodeHighlighter/types';

export interface DemoEntry {
  /** Variant name used as the key in the returned code. */
  name: string;
  /** Source file URL. */
  url: string;
  /** Displayed file name. Defaults to the file name in the URL. */
  fileName?: string;
  /**
   * Language used to pick the grammar, overriding the file extension. Set this
   * when the extension picks no grammar of its own. The JavaScript family
   * shares one grammar, so JSX in a `.js` file needs no override.
   */
  language?: string;
  /** Named export that provides the demo component. */
  namedExport?: string;
}

export interface PrecomputeDemoOptions {
  /** Source entries to process. */
  entries: DemoEntry[];
  /** Source loader. Defaults to the local filesystem loader. */
  loadSource?: LoadSource;
  /** Source parser used for syntax highlighting. */
  sourceParser?: Promise<ParseSource>;
  /** Source transformations applied before parsing. */
  sourceTransformers?: SourceTransformers;
  /** HAST transformations applied after parsing. */
  sourceEnhancers?: SourceEnhancers;
  /** Serialized source format. Defaults to `hastCompressed`. */
  output?: 'hast' | 'hastJson' | 'hastCompressed';
  /** Maximum relative-import depth. */
  maxDepth?: number;
  /** Whether the default source loader follows relative imports. */
  includeDependencies?: boolean;
  /**
   * Compatibility preview source. Resolved against each variant's loaded source
   * into a {@link EditableSourceProjection} on that variant, naming the region a
   * collapsed view shows and an edit patches back into. Skipped, with a
   * development warning, for a variant the preview cannot be resolved against.
   */
  preview?: string;
}

export interface PrecomputedDemo {
  /** Processed source keyed by entry name. */
  code: Code;
  /** External imports collected from every source file. */
  externals: Externals;
  /** Unique source URLs used by the demo. */
  dependencies: string[];
}
