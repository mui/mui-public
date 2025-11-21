// This is the export format expected by a remark plugin.

import { transformMarkdownMetadata } from './transformMarkdownMetadata';

export default transformMarkdownMetadata;

// Export the metadata conversion functions
export {
  metadataToMarkdown,
  metadataToMarkdownAst,
  markdownToMetadata,
} from './metadataToMarkdown';
export type { PageMetadata, PagesMetadata } from './metadataToMarkdown';

// Export metadata merge function
export { mergeMetadataMarkdown } from './mergeMetadataMarkdown';

// Export page index update function
export { updatePageIndex } from './updatePageIndex';
export type { UpdatePageIndexOptions } from './updatePageIndex';

// Export markdown node creation utilities
export * from './createMarkdownNodes';
