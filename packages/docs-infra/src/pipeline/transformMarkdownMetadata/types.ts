import type { PhrasingContent } from 'mdast';

/**
 * Plugin options for transformMarkdownMetadata
 */
export interface TransformMarkdownMetadataOptions {
  /**
   * A suffix to append to the title when saving it to the `export const metadata` object.
   * This suffix is not included in the metadata used for index extraction or returned metadata.
   *
   * Useful for adding site-wide title suffixes like " | My Site" to page metadata.
   *
   * @example
   * ```ts
   * transformMarkdownMetadata({ titleSuffix: ' | Base UI' })
   * // Title "Button" becomes "Button | Base UI" in the export
   * ```
   */
  titleSuffix?: string;

  /**
   * Controls automatic extraction of page metadata to parent directory index files.
   *
   * When enabled, the plugin extracts metadata (title, description, headings) from MDX files
   * and maintains an index in the parent directory's page.mdx file.
   *
   * Index files themselves (e.g., pattern/page.mdx) are automatically excluded from extraction.
   *
   * Can be:
   * - `false` - Disabled
   * - `true` - Enabled with default filter: `{ include: ['app/'], exclude: [] }`
   * - `{ include: string[], exclude: string[] }` - Enabled with custom path filters
   *
   * Path matching uses prefix matching - a file matches if it starts with any include path
   * and doesn't start with any exclude path. Files that are index files themselves
   * (matching pattern/page.mdx) are automatically skipped.
   */
  extractToIndex?:
    | boolean
    | {
        /** Path prefixes that files must match to have metadata extracted */
        include: string[];
        /** Path prefixes to exclude from metadata extraction */
        exclude: string[];
        /** Base directory to strip from file paths before matching (e.g., '/path/to/project/docs') */
        baseDir?: string;
        /** Only update existing indexes, don't create new ones */
        onlyUpdateIndexes?: boolean;
        /**
         * Directory to write marker files when indexes are updated.
         * Path is relative to baseDir.
         * Set to false to disable marker file creation.
         * @default false
         */
        markerDir?: string | false;
        /**
         * Throw an error if the index is out of date or missing.
         * Useful for CI environments to ensure indexes are committed.
         * @default false
         */
        errorIfOutOfDate?: boolean;
        /**
         * Use the first visible paragraph as the description in the extracted index,
         * even if a meta tag description is present.
         * This does not affect the `export const metadata` which will still use the meta tag.
         * @default false
         */
        useVisibleDescription?: boolean;
      };
}

/**
 * Represents a hierarchical structure of headings.
 * Each heading is keyed by its slug, with title and nested children.
 */
export type HeadingHierarchy = {
  [slug: string]: {
    title: string; // Plain text for display and slug generation
    titleMarkdown: PhrasingContent[]; // AST nodes preserving formatting (backticks, bold, italics)
    children: HeadingHierarchy;
  };
};

/**
 * Extracted metadata from markdown/MDX files
 */
export interface ExtractedMetadata {
  title?: string;
  description?: string;
  descriptionMarkdown?: PhrasingContent[]; // AST nodes preserving formatting (inline code, bold, italics, links)
  keywords?: string[];
  sections?: HeadingHierarchy;
  embeddings?: number[];
  openGraph?: {
    title?: string;
    description?: string;
    images?: Array<{
      url: string;
      width: number;
      height: number;
      alt: string;
    }>;
  };
}
