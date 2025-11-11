import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Heading, Paragraph, Root } from 'mdast';
import { updatePageIndex } from './updatePageIndex';
import type { PageMetadata } from './metadataToMarkdown';

export interface TransformMarkdownMetadataOptions {
  /**
   * Controls automatic extraction of page metadata to parent directory index files.
   *
   * When enabled, the plugin extracts metadata (title, description, headings) from MDX files
   * and maintains an index in the parent directory's page.mdx file.
   *
   * Can be:
   * - `false` - Disabled
   * - `true` - Enabled with default filter: `{ include: ['app/'], exclude: ['app/page.mdx'] }`
   * - `{ include: string[], exclude: string[] }` - Enabled with custom path filters
   *
   * Path matching uses prefix matching - a file matches if it starts with any include path
   * and doesn't start with any exclude path.
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
      };
}

export interface ExtractedMetadata {
  title?: string;
  description?: string;
  descriptionMarkdown?: any[]; // AST nodes preserving formatting (inline code, bold, italics, links)
  keywords?: string[];
  sections?: HeadingHierarchy;
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
      text += child.value;
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
      // Extract plain text without backticks for slug generation
      text += child.value;
    } else if ('children' in child) {
      // Recursively extract from nested elements (strong, emphasis, etc.)
      text += extractTextFromChildren(child.children);
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
 * Converts extracted metadata to PageMetadata format for index updates
 */
function toPageMetadata(metadata: ExtractedMetadata, filePath: string): PageMetadata {
  // Extract the slug from the file path (directory name)
  const parts = filePath.split('/');
  const pageFileName = parts[parts.length - 1]; // e.g., 'page.mdx'
  const slug = parts[parts.length - 2]; // e.g., 'button' from 'button/page.mdx'

  // Create relative path for the link
  const path = `./${slug}/${pageFileName}`;

  return {
    slug,
    path,
    title: metadata.title,
    description: metadata.description,
    descriptionMarkdown: metadata.descriptionMarkdown,
    keywords: metadata.keywords,
    sections: metadata.sections,
    openGraph: metadata.openGraph,
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

    // First pass: extract metadata export if it exists
    visit(root, (node: any) => {
      if (node.type === 'mdxjsEsm' && node.data?.estree) {
        const extracted = parseMetadataFromEstree(node.data.estree);
        if (extracted) {
          metadata = extracted;
          metadataNode = node; // Keep reference to the node
        }
      }
    });

    // Second pass: extract headings and find first h1 + paragraph
    let foundFirstH1 = false;
    let nextNodeAfterH1: any = null;
    let firstParagraphMarkdown: any[] | undefined;

    visit(root, (node: any, index, parent) => {
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
        firstParagraphMarkdown = paragraphNode.children; // Preserve AST nodes for formatting
        nextNodeAfterH1 = null; // Clear the marker
      }
    });

    // Fill in missing title and description if we have them from content
    let shouldUpdateMetadata = false;
    if (metadata) {
      const mutableMetadata = metadata as ExtractedMetadata;

      // Add title if missing
      if (firstH1 && !mutableMetadata.title) {
        mutableMetadata.title = firstH1;
        shouldUpdateMetadata = true;
      }

      // Add description if missing
      if (firstParagraphAfterH1 && !mutableMetadata.description) {
        mutableMetadata.description = firstParagraphAfterH1;
        shouldUpdateMetadata = true;
      }

      // Add descriptionMarkdown if missing and we have the markdown nodes
      if (firstParagraphMarkdown && !mutableMetadata.descriptionMarkdown) {
        mutableMetadata.descriptionMarkdown = firstParagraphMarkdown;
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

      if (firstParagraphAfterH1 && !mutableMetadata.openGraph.description) {
        mutableMetadata.openGraph.description = firstParagraphAfterH1;
        shouldUpdateMetadata = true;
      }

      // Add sections hierarchy if we have headings
      if (headings.length > 1 && !mutableMetadata.sections) {
        mutableMetadata.sections = buildHeadingHierarchy(headings);
        shouldUpdateMetadata = true;
      }

      // Update the metadata in the ESTree if we added any fields
      if (shouldUpdateMetadata && metadataNode?.data?.estree) {
        updateMetadataInEstree(metadataNode.data.estree, mutableMetadata);
      }
    } else if (firstH1 || firstParagraphAfterH1) {
      // Create metadata if we found h1 or paragraph but no metadata export exists
      metadata = {
        title: firstH1 || undefined,
        description: firstParagraphAfterH1 || undefined,
        descriptionMarkdown: firstParagraphMarkdown || undefined,
        sections: headings.length > 1 ? buildHeadingHierarchy(headings) : undefined,
        openGraph: {
          title: firstH1 || undefined,
          description: firstParagraphAfterH1 || undefined,
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

        // Check if file matches any include pattern (prefix match)
        const isIncluded =
          include.length === 0 || include.some((pattern) => normalizedPath.startsWith(pattern));

        // Check if file matches any exclude pattern (prefix match)
        const isExcluded =
          exclude.length > 0 && exclude.some((pattern) => normalizedPath.startsWith(pattern));

        shouldExtract = isIncluded && !isExcluded;
      }

      if (shouldExtract) {
        try {
          const pageMetadata = toPageMetadata(metadata, file.path);
          await updatePageIndex({
            pagePath: file.path,
            metadata: pageMetadata,
          });
        } catch (error) {
          // Don't fail the build if index update fails
          console.error('Failed to update page index for', file.path, error);
        }
      }
    }
  };
};
