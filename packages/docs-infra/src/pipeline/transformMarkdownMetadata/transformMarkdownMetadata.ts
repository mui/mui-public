import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Heading, Paragraph, Root } from 'mdast';
import { dirname, relative } from 'node:path';
import { updatePageIndex } from './updatePageIndex';
import type { PageMetadata } from './metadataToMarkdown';
import { generateEmbeddings } from '../generateEmbeddings/generateEmbeddings';

export interface TransformMarkdownMetadataOptions {
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
      };
  /**
   * Enable generation of embeddings for full text content.
   * When enabled, generates 512-dimensional vector embeddings from page content
   * for semantic search capabilities.
   *
   * Note: Requires optional peer dependencies to be installed:
   * - @orama/plugin-embeddings
   * - @tensorflow/tfjs
   * - @tensorflow/tfjs-backend-wasm
   *
   * @default false
   */
  generateEmbeddings?: boolean;
}

export interface ExtractedMetadata {
  title?: string;
  description?: string;
  descriptionMarkdown?: any[]; // AST nodes preserving formatting (inline code, bold, italics, links)
  keywords?: string[];
  sections?: HeadingHierarchy;
  embeddings?: number[];
  parts?: string[]; // Component parts (e.g., ['Root', 'Trigger', 'Popup'])
  props?: string[]; // Component props (deduplicated from all parts)
  dataAttributes?: string[]; // Data attributes (deduplicated from all parts)
  cssVariables?: string[]; // CSS variables (deduplicated from all parts)
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

/**
 * Represents a hierarchical structure of headings.
 * Each heading is keyed by its slug, with title and nested children.
 */
export type HeadingHierarchy = {
  [slug: string]: {
    title: string; // Plain text for display and slug generation
    titleMarkdown: any[]; // AST nodes preserving formatting (backticks, bold, italics)
    children: HeadingHierarchy;
  };
};

/**
 * Extracts text content from paragraph nodes
 */
function extractParagraphText(node: Paragraph): string {
  let text = '';
  for (const child of node.children) {
    if (child.type === 'text') {
      text += child.value;
    } else if (child.type === 'inlineCode') {
      // Preserve backticks for inline code
      text += `\`${child.value}\``;
    } else if ('children' in child) {
      // Handle nested elements like strong, emphasis, etc.
      text += extractTextFromChildren(child.children);
    }
  }
  // Replace newlines with spaces and normalize whitespace
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Recursively extracts text from children nodes
 */
function extractTextFromChildren(children: any[]): string {
  let text = '';
  for (const child of children) {
    if (child.type === 'text') {
      text += child.value;
    } else if (child.type === 'inlineCode') {
      // Preserve backticks for inline code
      text += `\`${child.value}\``;
    } else if ('children' in child) {
      // Recursively extract from nested elements (strong, emphasis, etc.)
      text += extractTextFromChildren(child.children);
    }
  }
  return text;
}

/**
 * Extracts plain text from children nodes (without formatting markers)
 */
function extractPlainTextFromChildren(children: any[]): string {
  let text = '';
  for (const child of children) {
    if (child.type === 'text') {
      text += child.value;
    } else if (child.type === 'inlineCode') {
      // Include inline code without backticks
      text += child.value;
    } else if ('children' in child) {
      // Recursively extract from nested elements
      text += extractPlainTextFromChildren(child.children);
    }
  }
  return text;
}

/**
 * Builds a hierarchical structure from flat headings array
 * Skips the first H1 (page title) and starts from H2
 */
function buildHeadingHierarchy(
  headings: Array<{ depth: number; text: string; children: any[] }>,
): HeadingHierarchy {
  // Skip the first heading (H1 - page title)
  const contentHeadings = headings.slice(1);

  if (contentHeadings.length === 0) {
    return {};
  }

  const root: HeadingHierarchy = {};
  const stack: Array<{ depth: number; node: HeadingHierarchy }> = [{ depth: 0, node: root }];

  for (const heading of contentHeadings) {
    // Pop from stack until we find the parent level
    while (stack.length > 0 && stack[stack.length - 1].depth >= heading.depth) {
      stack.pop();
    }

    // Get the current parent node
    const parent = stack[stack.length - 1].node;

    // Create slug from heading text (plain text without formatting)
    const slug = heading.text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Create new node for this heading
    const newNode = {
      title: heading.text, // Plain text for display
      titleMarkdown: heading.children, // AST nodes preserving formatting
      children: {} as HeadingHierarchy,
    };
    parent[slug] = newNode;

    // Push this heading onto the stack
    stack.push({ depth: heading.depth, node: newNode.children });
  }

  return root;
}

/**
 * Parses the metadata object from an ESTree node
 */
function parseMetadataFromEstree(estree: any): ExtractedMetadata | null {
  try {
    const body = estree?.body || [];
    for (const node of body) {
      if (
        node.type === 'ExportNamedDeclaration' &&
        node.declaration?.type === 'VariableDeclaration'
      ) {
        const declarations = node.declaration.declarations || [];
        for (const decl of declarations) {
          if (decl.id?.name === 'metadata' && decl.init?.type === 'ObjectExpression') {
            // Convert ESTree ObjectExpression to plain object
            return convertEstreeObjectToPlain(decl.init);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error parsing metadata from estree:', error);
  }
  return null;
}

/**
 * Converts an ESTree ObjectExpression to a plain JavaScript object
 */
function convertEstreeObjectToPlain(node: any): any {
  if (node.type === 'ObjectExpression') {
    const obj: any = {};
    for (const prop of node.properties) {
      if (prop.type === 'Property' && prop.key) {
        const key = prop.key.name || prop.key.value;
        obj[key] = convertEstreeObjectToPlain(prop.value);
      }
    }
    return obj;
  }
  if (node.type === 'ArrayExpression') {
    return node.elements.map((el: any) => convertEstreeObjectToPlain(el));
  }
  if (node.type === 'Literal') {
    return node.value;
  }
  if (node.type === 'Identifier') {
    return node.name;
  }
  return undefined;
}

/**
 * Checks if a directory name is a Next.js route group (wrapped in parentheses)
 */
function isRouteGroup(dirName: string): boolean {
  return dirName.startsWith('(') && dirName.endsWith(')');
}

/**
 * Gets the parent directory, skipping over Next.js route groups if requested
 */
function getParentDir(path: string, skipRouteGroups: boolean = false): string {
  let parent = dirname(path);

  if (skipRouteGroups) {
    while (parent !== dirname(parent) && isRouteGroup(parent.split('/').pop() || '')) {
      parent = dirname(parent);
    }
  }

  return parent;
}

/**
 * Converts extracted metadata to PageMetadata format for index updates
 */
function toPageMetadata(metadata: ExtractedMetadata, filePath: string): PageMetadata {
  // Extract the slug from the file path (directory name containing the page)
  const parts = filePath.split('/');
  const pageFileName = parts[parts.length - 1]; // e.g., 'page.mdx'

  // Get the directory containing the page file
  const pageDir = dirname(filePath);

  // Find the slug by looking backwards for the first non-route-group directory
  let slug = '';
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    if (!isRouteGroup(parts[i])) {
      slug = parts[i];
      break;
    }
  }

  // Calculate parent directory (skipping route groups, matching updatePageIndex behavior)
  const parentDir = getParentDir(pageDir, true);

  // Create relative path from parent to page
  const relativePath = relative(parentDir, pageDir);
  const path = `./${relativePath}/${pageFileName}`;

  return {
    slug,
    path,
    title: metadata.title,
    description: metadata.description,
    descriptionMarkdown: metadata.descriptionMarkdown,
    keywords: metadata.keywords,
    sections: metadata.sections,
    openGraph: metadata.openGraph,
    embeddings: metadata.embeddings,
  };
}

/**
 * Converts a plain value to an ESTree literal or expression
 */
function valueToEstree(value: any): any {
  if (value === null || value === undefined) {
    return { type: 'Literal', value: null };
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { type: 'Literal', value };
  }
  if (Array.isArray(value)) {
    return {
      type: 'ArrayExpression',
      elements: value.map((item) => valueToEstree(item)),
    };
  }
  if (typeof value === 'object') {
    return {
      type: 'ObjectExpression',
      properties: Object.entries(value)
        .filter(([, val]) => val !== undefined)
        .map(([key, val]) => {
          // Check if key is a valid JavaScript identifier
          const isValidIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key);

          return {
            type: 'Property',
            key: isValidIdentifier
              ? { type: 'Identifier', name: key }
              : { type: 'Literal', value: key },
            value: valueToEstree(val),
            kind: 'init',
            method: false,
            shorthand: false,
            computed: false,
          };
        }),
    };
  }
  return { type: 'Literal', value: null };
}

/**
 * Updates the metadata object in an existing ESTree
 */
function updateMetadataInEstree(estree: any, metadata: ExtractedMetadata): void {
  const body = estree?.body || [];
  for (const node of body) {
    if (
      node.type === 'ExportNamedDeclaration' &&
      node.declaration?.type === 'VariableDeclaration'
    ) {
      const declarations = node.declaration.declarations || [];
      for (const decl of declarations) {
        if (decl.id?.name === 'metadata' && decl.init?.type === 'ObjectExpression') {
          // Merge new metadata into existing object
          const existingProps = decl.init.properties || [];
          const existingKeys = new Set(
            existingProps
              .filter((prop: any) => prop.type === 'Property')
              .map((prop: any) => prop.key?.name || prop.key?.value),
          );

          // Add missing properties
          const metadataObj = valueToEstree(metadata);
          for (const prop of metadataObj.properties) {
            const key = prop.key.name;
            if (!existingKeys.has(key)) {
              existingProps.push(prop);
            }
          }
          return;
        }
      }
    }
  }
}

/**
 * Creates a new metadata export node
 */
function createMetadataExport(metadata: ExtractedMetadata): any {
  const metadataObj = valueToEstree(metadata);

  return {
    type: 'mdxjsEsm',
    value: '',
    data: {
      estree: {
        type: 'Program',
        sourceType: 'module',
        body: [
          {
            type: 'ExportNamedDeclaration',
            declaration: {
              type: 'VariableDeclaration',
              declarations: [
                {
                  type: 'VariableDeclarator',
                  id: { type: 'Identifier', name: 'metadata' },
                  init: metadataObj,
                },
              ],
              kind: 'const',
            },
            specifiers: [],
            source: null,
          },
        ],
      },
    },
  };
}

export const transformMarkdownMetadata: Plugin<[TransformMarkdownMetadataOptions?]> = (
  options = {},
) => {
  return async (tree, file) => {
    const root = tree as Root;
    const headings: Array<{ depth: number; text: string; children: any[] }> = [];
    let metadata: ExtractedMetadata | null = null;
    let firstH1: string | null = null;
    let firstParagraphAfterH1: string | null = null;
    let metadataNode: any = null; // Track the ESM node containing metadata
    let metaDescription: string | null = null; // Track meta tag description
    let metaKeywords: string[] | null = null; // Track meta tag keywords
    let foundFirstH1 = false;
    let nextNodeAfterH1: any = null;
    let firstParagraphMarkdown: any[] | undefined;
    const fullTextParts: string[] = []; // Collect text parts for fullText - headings and content alternating

    // Single pass: extract metadata export, meta tags, headings, first paragraph, and full text
    visit(root, (node: any, index, parent) => {
      // Extract metadata export if it exists
      if (node.type === 'mdxjsEsm' && node.data?.estree) {
        const extracted = parseMetadataFromEstree(node.data.estree);
        if (extracted) {
          metadata = extracted;
          metadataNode = node; // Keep reference to the node
        }
      }

      // Look for meta tags (can appear anywhere in the document)
      if (
        (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
        (node.name === 'meta' || node.name === 'Meta')
      ) {
        // Check attributes to find the meta tag type
        const attributes = node.attributes || [];
        let metaName: string | null = null;
        let contentValue: string | null = null;

        for (const attr of attributes) {
          if (attr.type === 'mdxJsxAttribute') {
            if (attr.name === 'name') {
              metaName = typeof attr.value === 'string' ? attr.value : null;
            }
            if (attr.name === 'content') {
              // Extract the content value
              if (typeof attr.value === 'string') {
                contentValue = attr.value;
              } else if (attr.value?.type === 'mdxJsxAttributeValueExpression') {
                // Handle expression values if needed
                contentValue = attr.value.value;
              }
            }
          }
        }

        // Process based on meta tag name
        if (metaName === 'description' && contentValue) {
          metaDescription = contentValue;
        } else if (metaName === 'keywords' && contentValue) {
          // Parse keywords CSV into array
          metaKeywords = contentValue.split(',').map((keyword) => keyword.trim());
        }
      }

      // Extract headings
      if (node.type === 'heading') {
        const heading = node as Heading;
        const text = extractTextFromChildren(heading.children);
        headings.push({
          depth: heading.depth,
          text,
          children: heading.children, // Preserve AST nodes for formatting
        });

        // Track first h1
        if (heading.depth === 1 && !foundFirstH1) {
          firstH1 = text;
          foundFirstH1 = true;

          // Mark that we need to check the next node
          if (parent && index !== undefined) {
            const parentNode = parent as any;
            if (parentNode.children && index + 1 < parentNode.children.length) {
              nextNodeAfterH1 = parentNode.children[index + 1];
            }
          }
        }
      }

      // Check if this is the paragraph right after the first h1
      if (
        foundFirstH1 &&
        !firstParagraphAfterH1 &&
        nextNodeAfterH1 &&
        node === nextNodeAfterH1 &&
        node.type === 'paragraph'
      ) {
        const paragraphNode = node as Paragraph;
        firstParagraphAfterH1 = extractParagraphText(paragraphNode);

        // If the paragraph contains a single JSX element wrapper, unwrap it
        // This handles cases like <Description>text</Description>
        if (
          paragraphNode.children.length === 1 &&
          paragraphNode.children[0].type === 'mdxJsxTextElement'
        ) {
          // Use the children of the JSX element instead of the wrapper
          firstParagraphMarkdown = paragraphNode.children[0].children;
        } else {
          // Preserve AST nodes for formatting
          firstParagraphMarkdown = paragraphNode.children;
        }
        nextNodeAfterH1 = null; // Clear the marker
      }

      // Extract full text content (excluding code blocks and metadata)
      // When we encounter a heading, push the heading text and then create a new empty slot for content
      if (node.type === 'heading') {
        const heading = node as Heading;
        const text = extractPlainTextFromChildren(heading.children).replace(/\s+/g, ' ').trim();
        if (text) {
          fullTextParts.push(text); // Add heading
          fullTextParts.push(''); // Create slot for content after this heading
        }
        return;
      }

      // Skip multiline code blocks
      if (node.type === 'code') {
        return;
      }

      // Skip metadata exports and JSX imports
      if (node.type === 'mdxjsEsm' || node.type === 'import') {
        return;
      }

      // Skip meta tags (they don't contribute to page content)
      if (
        (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
        (node.name === 'meta' || node.name === 'Meta')
      ) {
        return;
      }

      // Handle paragraphs for full text
      if (node.type === 'paragraph') {
        const text = extractPlainTextFromChildren(node.children).replace(/\s+/g, ' ').trim();
        if (text) {
          // Append to the last slot (current section's content)
          if (fullTextParts.length === 0) {
            fullTextParts.push(text);
          } else {
            const lastIndex = fullTextParts.length - 1;
            fullTextParts[lastIndex] = fullTextParts[lastIndex]
              ? `${fullTextParts[lastIndex]} ${text}`
              : text;
          }
        }
      }

      // Handle lists - condense into comma-separated items
      if (node.type === 'list') {
        const listItems: string[] = [];
        for (const item of node.children || []) {
          if (item.type === 'listItem') {
            const itemText = extractPlainTextFromChildren(item.children || [])
              .replace(/\s+/g, ' ')
              .trim();
            if (itemText) {
              listItems.push(itemText);
            }
          }
        }
        if (listItems.length > 0) {
          const text = listItems.join(', ');
          // Append to the last slot (current section's content)
          if (fullTextParts.length === 0) {
            fullTextParts.push(text);
          } else {
            const lastIndex = fullTextParts.length - 1;
            fullTextParts[lastIndex] = fullTextParts[lastIndex]
              ? `${fullTextParts[lastIndex]} ${text}`
              : text;
          }
        }
      }

      // Handle blockquotes - their paragraphs will be picked up by the paragraph handler above
    });

    // Build full text from collected parts
    const fullText = fullTextParts
      .map((part) => {
        const trimmed = part.trim();
        if (!trimmed) {
          return '';
        }
        // Add period if it doesn't end with punctuation
        if (!/[.!?]$/.test(trimmed)) {
          return `${trimmed}.`;
        }
        return trimmed;
      })
      .filter((part) => part.length > 0)
      .join(' ');

    const embeddings = options.generateEmbeddings ? generateEmbeddings(fullText) : null;

    // Fill in missing title and description if we have them from content
    let shouldUpdateMetadata = false;
    if (metadata) {
      const mutableMetadata = metadata as ExtractedMetadata;

      // Add title if missing
      if (firstH1 && !mutableMetadata.title) {
        mutableMetadata.title = firstH1;
        shouldUpdateMetadata = true;
      }

      // Add description - prioritize meta tag over paragraph
      if (!mutableMetadata.description) {
        if (metaDescription) {
          mutableMetadata.description = metaDescription;
          shouldUpdateMetadata = true;
        } else if (firstParagraphAfterH1) {
          mutableMetadata.description = firstParagraphAfterH1;
          shouldUpdateMetadata = true;
        }
      }

      // Add descriptionMarkdown if missing
      // If we used meta tag, set to empty array since meta has no children
      // Otherwise use the paragraph markdown nodes
      if (!mutableMetadata.descriptionMarkdown) {
        if (metaDescription) {
          mutableMetadata.descriptionMarkdown = [];
          shouldUpdateMetadata = true;
        } else if (firstParagraphMarkdown) {
          mutableMetadata.descriptionMarkdown = firstParagraphMarkdown;
          shouldUpdateMetadata = true;
        }
      }

      // Add keywords from meta tag if present
      if (metaKeywords && !mutableMetadata.keywords) {
        mutableMetadata.keywords = metaKeywords;
        shouldUpdateMetadata = true;
      }

      // Fill in openGraph title and description if missing
      if (!mutableMetadata.openGraph) {
        mutableMetadata.openGraph = {};
      }

      if (firstH1 && !mutableMetadata.openGraph.title) {
        mutableMetadata.openGraph.title = firstH1;
        shouldUpdateMetadata = true;
      }

      // Prioritize meta tag description over paragraph for openGraph
      if (!mutableMetadata.openGraph.description) {
        if (metaDescription) {
          mutableMetadata.openGraph.description = metaDescription;
          shouldUpdateMetadata = true;
        } else if (firstParagraphAfterH1) {
          mutableMetadata.openGraph.description = firstParagraphAfterH1;
          shouldUpdateMetadata = true;
        }
      }

      // Add sections hierarchy if we have headings
      const hasSections =
        mutableMetadata.sections && Object.keys(mutableMetadata.sections).length > 0;
      if (headings.length > 1 && !hasSections) {
        mutableMetadata.sections = buildHeadingHierarchy(headings);
        shouldUpdateMetadata = true;
      }

      // Add embeddings if missing
      if (!mutableMetadata.embeddings && embeddings) {
        mutableMetadata.embeddings = await embeddings;
        shouldUpdateMetadata = true;
      }

      // Update the metadata in the ESTree if we added any fields
      if (shouldUpdateMetadata && metadataNode?.data?.estree) {
        updateMetadataInEstree(metadataNode.data.estree, mutableMetadata);
      }
    } else if (firstH1 || firstParagraphAfterH1 || metaDescription || metaKeywords) {
      // Create metadata if we found h1, paragraph, or meta tags but no metadata export exists
      // Prioritize meta tag description over paragraph
      const descriptionValue = metaDescription || firstParagraphAfterH1 || undefined;
      const descriptionMarkdownValue = metaDescription ? [] : firstParagraphMarkdown || undefined;

      const embeddingsValue = embeddings ? await embeddings : undefined;

      metadata = {
        title: firstH1 || undefined,
        description: descriptionValue,
        descriptionMarkdown: descriptionMarkdownValue,
        keywords: metaKeywords || undefined,
        sections: headings.length > 1 ? buildHeadingHierarchy(headings) : undefined,
        embeddings: embeddingsValue,
        openGraph: {
          title: firstH1 || undefined,
          description: descriptionValue,
        },
      };

      // Create a new metadata export and add it to the tree
      const metadataExport = createMetadataExport(metadata);
      root.children.unshift(metadataExport as any);
    }

    // Update parent index if requested and file path matches filters
    if (options.extractToIndex && metadata && file.path) {
      // Normalize extractToIndex options
      let shouldExtract = false;

      if (typeof options.extractToIndex === 'boolean') {
        shouldExtract = options.extractToIndex;
      } else {
        const { include = [], exclude = [], baseDir } = options.extractToIndex;
        let filePath = file.path;

        // Strip base directory if provided
        if (baseDir && filePath.startsWith(baseDir)) {
          filePath = filePath.substring(baseDir.length);
          // Remove leading slash if present
          if (filePath.startsWith('/')) {
            filePath = filePath.substring(1);
          }
        }

        // Normalize path by removing Next.js route groups (parentheses)
        // e.g., "app/(shared)/page.mdx" becomes "app/page.mdx"
        const normalizedPath = filePath.replace(/\/\([^)]+\)/g, '');

        // Skip if the file exactly matches an include pattern ending with /page.mdx
        // This prevents index files from extracting metadata to their parent
        const isIndexFile = include.some((pattern) => normalizedPath === pattern);
        if (isIndexFile) {
          shouldExtract = false;
        } else {
          // Check if file matches any include pattern (must be inside the directory and not the index itself)
          // The file must start with "pattern/" to ensure it's a child, not a sibling
          // and must not be "pattern/page.mdx" to ensure it's not the index file itself
          const matchedIncludePattern = include.find((pattern) => {
            return (
              normalizedPath.startsWith(`${pattern}/`) && normalizedPath !== `${pattern}/page.mdx`
            );
          });
          const isIncluded = include.length === 0 || matchedIncludePattern !== undefined;

          // Check if file matches any exclude pattern
          const matchedExcludePattern = exclude.find((pattern) => {
            return normalizedPath.startsWith(`${pattern}/`);
          });
          const isExcluded = matchedExcludePattern !== undefined;

          shouldExtract = isIncluded && !isExcluded;
        }
      }

      if (shouldExtract) {
        try {
          const pageMetadata = toPageMetadata(metadata, file.path);
          const updateOptions: Parameters<typeof updatePageIndex>[0] = {
            pagePath: file.path,
            metadata: pageMetadata,
            updateParents: true,
          };

          // Pass through baseDir, include, exclude, onlyUpdateIndexes, and markerDir if they were configured
          if (typeof options.extractToIndex !== 'boolean') {
            if (options.extractToIndex.baseDir) {
              updateOptions.baseDir = options.extractToIndex.baseDir;
            }
            if (options.extractToIndex.include) {
              updateOptions.include = options.extractToIndex.include;
            }
            if (options.extractToIndex.exclude) {
              updateOptions.exclude = options.extractToIndex.exclude;
            }
            if (options.extractToIndex.onlyUpdateIndexes !== undefined) {
              updateOptions.onlyUpdateIndexes = options.extractToIndex.onlyUpdateIndexes;
            }
            if (options.extractToIndex.markerDir !== undefined) {
              updateOptions.markerDir = options.extractToIndex.markerDir;
            }
          }

          await updatePageIndex(updateOptions);
        } catch (error) {
          // Don't fail the build if index update fails
          console.error('Failed to update page index for', file.path, error);
        }
      }
    }
  };
};
