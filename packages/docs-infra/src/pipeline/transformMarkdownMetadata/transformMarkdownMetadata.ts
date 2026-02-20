import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Heading, Paragraph, PhrasingContent, Root, Nodes, RootContent } from 'mdast';
import type { Program, Property, Expression } from 'estree';
import { dirname, relative } from 'node:path';
import { syncPageIndex } from '../syncPageIndex';
import { markdownToMetadata } from '../syncPageIndex/metadataToMarkdown';
import type { PageMetadata } from '../syncPageIndex/metadataToMarkdown';
import type { SitemapSectionData, SitemapPage } from '../../createSitemap/types';
import type {
  TransformMarkdownMetadataOptions,
  HeadingHierarchy,
  ExtractedMetadata,
} from './types';

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
  // Replace newlines with spaces and normalize whitespace, preserving non-breaking spaces
  return text.replace(/[ \t\n\r]+/g, ' ').trim();
}

/**
 * Recursively extracts text from children nodes
 */
function extractTextFromChildren(children: PhrasingContent[]): string {
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
function extractPlainTextFromChildren(children: PhrasingContent[]): string {
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
 * Slugify function for generating URL-friendly slugs from heading text.
 * Lowercases text and replaces non-alphanumeric characters with hyphens.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Builds a hierarchical structure from flat headings array
 * Skips the first H1 (page title) and starts from H2
 */
function buildHeadingHierarchy(
  headings: Array<{ depth: number; text: string; children: PhrasingContent[] }>,
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

    // Create slug from heading text using the provided slugify function
    const slug = slugify(heading.text);

    // Create new node for this heading
    const newNode: HeadingHierarchy[string] = {
      title: heading.text, // Plain text for display
      titleMarkdown: heading.children, // AST nodes preserving formatting
      children: {},
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
function parseMetadataFromEstree(estree: Program): ExtractedMetadata | null {
  try {
    const body = estree?.body || [];
    for (const node of body) {
      if (
        node.type === 'ExportNamedDeclaration' &&
        node.declaration?.type === 'VariableDeclaration'
      ) {
        const declarations = node.declaration.declarations || [];
        for (const decl of declarations) {
          if (
            decl.id?.type === 'Identifier' &&
            decl.id.name === 'metadata' &&
            decl.init?.type === 'ObjectExpression'
          ) {
            // Convert ESTree ObjectExpression to plain object
            return convertEstreeObjectToPlain(decl.init) as ExtractedMetadata | null;
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
function convertEstreeObjectToPlain(
  node: unknown,
): string | number | boolean | null | undefined | Record<string, unknown> | unknown[] {
  if (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    node.type === 'ObjectExpression'
  ) {
    const obj: Record<string, unknown> = {};
    if ('properties' in node && Array.isArray(node.properties)) {
      for (const prop of node.properties) {
        if (
          typeof prop === 'object' &&
          prop !== null &&
          'type' in prop &&
          prop.type === 'Property' &&
          'key' in prop &&
          prop.key
        ) {
          let key = '';
          if ('name' in prop.key && typeof prop.key.name === 'string') {
            key = prop.key.name;
          } else if ('value' in prop.key) {
            key = String(prop.key.value);
          }
          if (key && 'value' in prop) {
            obj[key] = convertEstreeObjectToPlain(prop.value);
          }
        }
      }
    }
    return obj;
  }
  if (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    node.type === 'ArrayExpression' &&
    'elements' in node &&
    Array.isArray(node.elements)
  ) {
    return node.elements.map((el) => convertEstreeObjectToPlain(el));
  }
  if (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    node.type === 'Literal' &&
    'value' in node
  ) {
    return node.value as string | number | boolean | null;
  }
  if (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    node.type === 'Identifier' &&
    'name' in node
  ) {
    return node.name as string;
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

interface ToPageMetadataOptions {
  /** Override description with the visible paragraph (ignoring meta tag) */
  visibleDescription?: string;
  /** Override descriptionMarkdown with the visible paragraph markdown */
  visibleDescriptionMarkdown?: PhrasingContent[];
}

/**
 * Converts extracted metadata to PageMetadata format for index updates
 */
function toPageMetadata(
  metadata: ExtractedMetadata,
  filePath: string,
  options: ToPageMetadataOptions = {},
): PageMetadata {
  // Extract the slug from the file path (directory name containing the page)
  const parts = filePath.split('/');
  const pageFileName = parts[parts.length - 1]; // e.g., 'page.mdx'

  // Get the directory containing the page file
  const pageDir = dirname(filePath);

  // Find the directory name by looking backwards for the first non-route-group directory
  let dirName = '';
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    if (!isRouteGroup(parts[i])) {
      dirName = parts[i];
      break;
    }
  }

  // Generate slug from title if available, otherwise from directory name
  // This ensures consistency with section slug generation (kebab-case for multi-word, lowercase for camelCase)
  const slug = metadata.title
    ? metadata.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    : dirName;

  // Calculate parent directory (skipping route groups, matching syncPageIndex behavior)
  const parentDir = getParentDir(pageDir, true);

  // Create relative path from parent to page
  const relativePath = relative(parentDir, pageDir);
  const path = `./${relativePath}/${pageFileName}`;

  return {
    slug,
    path,
    title: metadata.title,
    description: options.visibleDescription ?? metadata.description,
    descriptionMarkdown: options.visibleDescriptionMarkdown ?? metadata.descriptionMarkdown,
    keywords: metadata.keywords,
    sections: metadata.sections,
    embeddings: metadata.embeddings,
    image: metadata.image,
    private: metadata.robots?.index === false || undefined,
  };
}

/**
 * Converts a plain value to an ESTree literal or expression
 */
function valueToEstree(value: unknown): {
  type: string;
  value?: unknown;
  elements?: unknown[];
  properties?: unknown[];
} {
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
function updateMetadataInEstree(estree: Program, metadata: ExtractedMetadata): void {
  const body = estree?.body || [];
  for (const node of body) {
    if (
      node.type === 'ExportNamedDeclaration' &&
      node.declaration?.type === 'VariableDeclaration'
    ) {
      const declarations = node.declaration.declarations || [];
      for (const decl of declarations) {
        if (
          decl.id?.type === 'Identifier' &&
          decl.id.name === 'metadata' &&
          decl.init?.type === 'ObjectExpression'
        ) {
          // Merge new metadata into existing object
          const existingProps = decl.init.properties || [];
          const existingKeys = new Set(
            existingProps
              .filter((prop) => prop.type === 'Property')
              .map((prop) => {
                if ('name' in prop.key) {
                  return (prop.key as { name: string }).name;
                }
                if ('value' in prop.key) {
                  return String((prop.key as { value: unknown }).value || '');
                }
                return '';
              }),
          );

          // Add missing properties
          const metadataObj = valueToEstree(metadata);
          if (
            typeof metadataObj === 'object' &&
            metadataObj !== null &&
            'properties' in metadataObj &&
            Array.isArray(metadataObj.properties)
          ) {
            for (const prop of metadataObj.properties) {
              if (
                typeof prop === 'object' &&
                prop !== null &&
                'key' in prop &&
                typeof prop.key === 'object' &&
                prop.key !== null &&
                'name' in prop.key
              ) {
                const key = prop.key.name;
                if (key && !existingKeys.has(String(key))) {
                  existingProps.push(prop as Property);
                }
              }
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
function createMetadataExport(metadata: ExtractedMetadata): {
  type: 'mdxjsEsm';
  value: string;
  data: { estree: Program };
} {
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
                  init: metadataObj as Expression,
                },
              ],
              kind: 'const',
            },
            specifiers: [],
            source: null,
            attributes: [],
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
    const headings: Array<{ depth: number; text: string; children: PhrasingContent[] }> = [];
    let metadata: ExtractedMetadata | null = null;
    let firstH1: string | null = null;
    let firstParagraphAfterH1: string | null = null;
    let metadataNode: Nodes | null = null; // Track the ESM node containing metadata
    let metaDescription: string | null = null; // Track meta tag description
    let metaKeywords: string[] | null = null; // Track meta tag keywords
    let foundFirstH1 = false;
    let nextNodeAfterH1: Nodes | null = null;
    let firstParagraphMarkdown: PhrasingContent[] | undefined;
    const fullTextParts: string[] = []; // Collect text parts for fullText - headings and content alternating

    // Single pass: extract metadata export, meta tags, headings, first paragraph, and full text
    visit(root, (node, index, parent) => {
      // Extract metadata export if it exists
      if (
        node.type === 'mdxjsEsm' &&
        'data' in node &&
        node.data &&
        typeof node.data === 'object' &&
        'estree' in node.data &&
        node.data.estree
      ) {
        const extracted = parseMetadataFromEstree(node.data.estree as Program);
        if (extracted) {
          metadata = extracted;
          metadataNode = node;
        }
      }

      // Look for meta tags (can appear anywhere in the document)
      if (
        (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
        'name' in node &&
        (node.name === 'meta' || node.name === 'Meta')
      ) {
        // Check attributes to find the meta tag type
        const attributes =
          'attributes' in node && Array.isArray(node.attributes) ? node.attributes : [];
        let metaName: string | null = null;
        let contentValue: string | null = null;

        for (const attr of attributes) {
          if (
            typeof attr === 'object' &&
            attr !== null &&
            'type' in attr &&
            attr.type === 'mdxJsxAttribute' &&
            'name' in attr
          ) {
            if (attr.name === 'name' && 'value' in attr) {
              metaName = typeof attr.value === 'string' ? attr.value : null;
            }
            if (attr.name === 'content' && 'value' in attr) {
              // Extract the content value
              if (typeof attr.value === 'string') {
                contentValue = attr.value;
              } else if (
                typeof attr.value === 'object' &&
                attr.value !== null &&
                'type' in attr.value &&
                attr.value.type === 'mdxJsxAttributeValueExpression' &&
                'value' in attr.value &&
                typeof attr.value.value === 'string'
              ) {
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
          if (
            parent &&
            index !== undefined &&
            'children' in parent &&
            Array.isArray(parent.children)
          ) {
            if (index + 1 < parent.children.length) {
              nextNodeAfterH1 = parent.children[index + 1];
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
          paragraphNode.children[0].type === 'mdxJsxTextElement' &&
          'children' in paragraphNode.children[0] &&
          Array.isArray(paragraphNode.children[0].children)
        ) {
          // Use the children of the JSX element instead of the wrapper
          firstParagraphMarkdown = paragraphNode.children[0].children as PhrasingContent[];
        } else {
          // Preserve AST nodes for formatting
          firstParagraphMarkdown = paragraphNode.children;
        }
        nextNodeAfterH1 = null; // Clear the marker
      }

      // Check if this is a JSX flow element right after the first h1 (multi-line JSX like <Subtitle>...</Subtitle>)
      // This handles cases where the JSX element spans multiple lines and becomes a block-level element
      if (
        foundFirstH1 &&
        !firstParagraphAfterH1 &&
        nextNodeAfterH1 &&
        node === nextNodeAfterH1 &&
        node.type === 'mdxJsxFlowElement' &&
        'name' in node &&
        node.name !== 'meta' &&
        node.name !== 'Meta' &&
        'children' in node &&
        Array.isArray(node.children)
      ) {
        // Extract text from the JSX element's children, preserving non-breaking spaces
        const textContent = extractPlainTextFromChildren(node.children as PhrasingContent[])
          .replace(/[ \t\n\r]+/g, ' ')
          .trim();
        if (textContent) {
          firstParagraphAfterH1 = textContent;
          firstParagraphMarkdown = node.children as PhrasingContent[];
        }
        nextNodeAfterH1 = null; // Clear the marker
      }

      // Extract full text content (excluding code blocks and metadata)
      // When we encounter a heading, push the heading text and then create a new empty slot for content
      if (node.type === 'heading') {
        const heading = node as Heading;
        // Preserve non-breaking spaces in heading text
        const text = extractPlainTextFromChildren(heading.children)
          .replace(/[ \t\n\r]+/g, ' ')
          .trim();
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

      // Skip metadata exports
      if (node.type === 'mdxjsEsm') {
        return;
      }

      // Skip meta tags (they don't contribute to page content)
      if (
        (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
        'name' in node &&
        (node.name === 'meta' || node.name === 'Meta')
      ) {
        return;
      }

      // Handle paragraphs for full text, preserving non-breaking spaces
      if (node.type === 'paragraph') {
        const text = extractPlainTextFromChildren(node.children)
          .replace(/[ \t\n\r]+/g, ' ')
          .trim();
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
      if (node.type === 'list' && 'children' in node && Array.isArray(node.children)) {
        const listItems: string[] = [];
        for (const item of node.children) {
          if (item.type === 'listItem' && 'children' in item && Array.isArray(item.children)) {
            // Preserve non-breaking spaces in list item text
            const itemText = extractPlainTextFromChildren(item.children as PhrasingContent[])
              .replace(/[ \t\n\r]+/g, ' ')
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

      // Add sections hierarchy if we have headings
      const hasSections =
        mutableMetadata.sections && Object.keys(mutableMetadata.sections).length > 0;
      if (headings.length > 1 && !hasSections) {
        mutableMetadata.sections = buildHeadingHierarchy(headings);
        shouldUpdateMetadata = true;
      }

      // Update the metadata in the ESTree if we added any fields
      if (shouldUpdateMetadata && metadataNode) {
        const esmNode = metadataNode as { type: string; data?: { estree?: Program } };
        if (esmNode.data?.estree) {
          // Apply titleSuffix only to the exported metadata, not to the internal metadata
          const exportMetadata =
            options.titleSuffix && mutableMetadata.title
              ? { ...mutableMetadata, title: mutableMetadata.title + options.titleSuffix }
              : mutableMetadata;
          updateMetadataInEstree(esmNode.data.estree, exportMetadata);
        }
      }
    } else if (firstH1 || firstParagraphAfterH1 || metaDescription || metaKeywords) {
      // Create metadata if we found h1, paragraph, or meta tags but no metadata export exists
      // Prioritize meta tag description over paragraph
      const descriptionValue = metaDescription || firstParagraphAfterH1 || undefined;
      const descriptionMarkdownValue = metaDescription ? [] : firstParagraphMarkdown || undefined;

      metadata = {
        title: firstH1 || undefined,
        description: descriptionValue,
        descriptionMarkdown: descriptionMarkdownValue,
        keywords: metaKeywords || undefined,
        sections: headings.length > 1 ? buildHeadingHierarchy(headings) : undefined,
      };

      // Create a new metadata export and add it to the tree
      // Apply titleSuffix only to the exported metadata, not to the internal metadata
      const exportMetadata =
        options.titleSuffix && metadata.title
          ? { ...metadata, title: metadata.title + options.titleSuffix }
          : metadata;
      const metadataExport = createMetadataExport(exportMetadata);
      root.children.unshift(metadataExport as RootContent);
    }

    // Inject sitemap data into wrapper components in autogenerated index files
    // This uses the indexWrapperComponent from extractToIndex options
    const wrapperComponent =
      typeof options.extractToIndex === 'object'
        ? options.extractToIndex.indexWrapperComponent
        : undefined;
    const extractBaseDir =
      typeof options.extractToIndex === 'object' ? options.extractToIndex.baseDir : undefined;

    if (wrapperComponent && file.path) {
      let fileContent: string | null = null;
      if (typeof file.value === 'string') {
        fileContent = file.value;
      } else if (file.value instanceof Buffer) {
        fileContent = file.value.toString('utf-8');
      }

      // Check if this is an autogenerated index file
      if (fileContent && fileContent.includes("[//]: # 'This file is autogenerated")) {
        // Parse the page list metadata from the markdown
        const pagesMetadata = await markdownToMetadata(fileContent);

        if (pagesMetadata) {
          // Compute prefix from file path
          let prefix = '/';
          let filePath = file.path;
          // Strip baseDir if provided
          if (extractBaseDir && filePath.startsWith(extractBaseDir)) {
            filePath = filePath.substring(extractBaseDir.length);
            if (filePath.startsWith('/')) {
              filePath = filePath.substring(1);
            }
          }
          // Get directory path and convert to URL prefix
          const dirPath = dirname(filePath);
          // Filter out src, app, and route groups from the path
          // First, split and filter to find meaningful segments
          const segments = dirPath.split('/').filter((seg) => {
            if (seg.startsWith('(') && seg.endsWith(')')) {
              return false;
            }
            if (seg === '.' || seg === '') {
              return false;
            }
            return true;
          });
          // Find and remove 'src' followed by 'app' pattern (common in Next.js projects)
          const srcIndex = segments.indexOf('src');
          if (srcIndex !== -1) {
            // Remove 'src'
            segments.splice(srcIndex, 1);
            // Check if 'app' now follows where 'src' was
            if (segments[srcIndex] === 'app') {
              segments.splice(srcIndex, 1);
            }
          } else {
            // No 'src', check for standalone 'app' at the same position pattern
            const appIndex = segments.indexOf('app');
            if (appIndex !== -1 && (appIndex === 0 || appIndex === srcIndex)) {
              segments.splice(appIndex, 1);
            }
          }
          prefix = segments.length > 0 ? `/${segments.join('/')}/` : '/';

          // Convert PagesMetadata to SitemapSectionData
          const sitemapData: SitemapSectionData = {
            title: pagesMetadata.title,
            prefix,
            pages: pagesMetadata.pages.map(
              (page): SitemapPage => ({
                title: page.title,
                slug: page.slug,
                path: page.path,
                description: page.description,
                keywords: page.keywords,
                sections: page.sections,
                parts: page.parts,
                exports: page.exports,
                tags: page.tags,
                skipDetailSection: page.skipDetailSection,
                image: page.image,
              }),
            ),
          };

          // Find and update the wrapper component in the AST
          visit(root, (node) => {
            if (
              node.type === 'mdxJsxFlowElement' &&
              'name' in node &&
              node.name === wrapperComponent
            ) {
              // Create the data attribute with expression value
              const dataAttr = {
                type: 'mdxJsxAttribute',
                name: 'data',
                value: {
                  type: 'mdxJsxAttributeValueExpression',
                  value: JSON.stringify(sitemapData),
                  data: {
                    estree: {
                      type: 'Program',
                      sourceType: 'module',
                      body: [
                        {
                          type: 'ExpressionStatement',
                          expression: valueToEstree(sitemapData) as Expression,
                        },
                      ],
                    },
                  },
                },
              };

              // Add the attribute to the element
              if ('attributes' in node && Array.isArray(node.attributes)) {
                // Remove existing data attribute if present
                const existingIndex = node.attributes.findIndex(
                  (attr: any) =>
                    attr &&
                    typeof attr === 'object' &&
                    'type' in attr &&
                    attr.type === 'mdxJsxAttribute' &&
                    'name' in attr &&
                    attr.name === 'data',
                );
                if (existingIndex !== -1) {
                  node.attributes.splice(existingIndex, 1);
                }
                node.attributes.push(dataAttr as any);
              }
            }
          });
        }
      }
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

        // Skip if the file is an index file (pattern/page.mdx)
        // This prevents index files from extracting metadata to their parent
        const isIndexFile = include.some((pattern) => {
          return normalizedPath === `${pattern}/page.mdx`;
        });
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
          // Determine if we should use visible description instead of meta tag
          const useVisibleDescription =
            typeof options.extractToIndex !== 'boolean' &&
            options.extractToIndex.useVisibleDescription;

          const pageMetadataOptions: ToPageMetadataOptions = {};
          if (useVisibleDescription && firstParagraphAfterH1) {
            pageMetadataOptions.visibleDescription = firstParagraphAfterH1;
            pageMetadataOptions.visibleDescriptionMarkdown = firstParagraphMarkdown;
          }

          const pageMetadata = toPageMetadata(metadata, file.path, pageMetadataOptions);
          const updateOptions: Parameters<typeof syncPageIndex>[0] = {
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
            if (options.extractToIndex.errorIfOutOfDate !== undefined) {
              updateOptions.errorIfOutOfDate = options.extractToIndex.errorIfOutOfDate;
            }
            if (options.extractToIndex.indexWrapperComponent) {
              updateOptions.indexWrapperComponent = options.extractToIndex.indexWrapperComponent;
            }
          }

          await syncPageIndex(updateOptions);
        } catch (error) {
          // Don't fail the build if index update fails
          console.error('Failed to update page index for', file.path, error);
        }
      }
    }
  };
};
