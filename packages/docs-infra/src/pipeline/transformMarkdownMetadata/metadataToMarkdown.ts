import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import type { Heading, Paragraph, Image, Link, Root } from 'mdast';
import type { ExtractedMetadata, HeadingHierarchy } from './transformMarkdownMetadata';
import { heading, paragraph, text, link, comment } from './createMarkdownNodes';

type HeadingNode = Heading;
type ParagraphNode = Paragraph;
type ImageNode = Image;
type LinkNode = Link;

// Definition nodes are used for markdown-style comments like [//]: # "Comment text"
interface DefinitionNode {
  type: 'definition';
  identifier: string;
  label: string;
  title?: string;
  url: string;
}

/**
 * Converts AST nodes (from heading.children) back to markdown string
 */
function astNodesToMarkdown(nodes: any[]): string {
  let result = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      result += node.value;
    } else if (node.type === 'inlineCode') {
      result += `\`${node.value}\``;
    } else if (node.type === 'emphasis') {
      result += `*${astNodesToMarkdown(node.children)}*`;
    } else if (node.type === 'strong') {
      result += `**${astNodesToMarkdown(node.children)}**`;
    } else if (node.type === 'link') {
      result += `[${astNodesToMarkdown(node.children)}](${node.url})`;
    } else if ('children' in node) {
      result += astNodesToMarkdown(node.children);
    }
  }
  return result;
}

export interface PageMetadata extends ExtractedMetadata {
  /** The slug/path for this page (e.g., 'button', 'checkbox') */
  slug: string;
  /** The relative path to the page's MDX file */
  path: string;
}

export interface PagesMetadata {
  /** The main title for the pages index */
  title: string;
  /** Array of page metadata */
  pages: PageMetadata[];
}

/**
 * Converts a HeadingHierarchy into markdown list format
 */
function headingHierarchyToMarkdown(
  hierarchy: HeadingHierarchy,
  basePath: string,
  depth: number = 0,
): string {
  let result = '';
  const indent = '  '.repeat(depth);

  for (const node of Object.values(hierarchy)) {
    const { titleMarkdown, children } = node;
    // Convert AST nodes back to markdown string with preserved formatting
    let titleString = astNodesToMarkdown(titleMarkdown);
    
    // Escape numbered list syntax (e.g., "1. Text" -> "1\. Text")
    // This prevents markdown from treating "- 1. Text" as a nested ordered list
    titleString = titleString.replace(/^(\d+)\.\s/, '$1\\. ');
    
    result += `${indent}- ${titleString}\n`;
    if (Object.keys(children).length > 0) {
      result += headingHierarchyToMarkdown(children, basePath, depth + 1);
    }
  }

  return result;
}

/**
 * Converts a HeadingHierarchy into markdown AST list nodes
 */
function headingHierarchyToListNodes(hierarchy: HeadingHierarchy, basePath: string): any[] {
  const listItems: any[] = [];

  for (const node of Object.values(hierarchy)) {
    const { titleMarkdown, children } = node;

    const listItem: any = {
      type: 'listItem',
      children: [
        {
          type: 'paragraph',
          children: titleMarkdown, // Use the preserved AST nodes directly
        },
      ],
    };

    // Add nested children if they exist
    if (Object.keys(children).length > 0) {
      const nestedList = {
        type: 'list',
        ordered: false,
        children: headingHierarchyToListNodes(children, basePath),
      };
      listItem.children.push(nestedList);
    }

    listItems.push(listItem);
  }

  return listItems;
}

/**
 * Strips position metadata from AST nodes recursively
 */
function stripPositions(nodes: any[]): any[] {
  return nodes.map((node) => {
    const { position, ...rest } = node;
    if (rest.children) {
      rest.children = stripPositions(rest.children);
    }
    return rest;
  });
}

/**
 * Parses a list of section links back into a HeadingHierarchy structure
 * Expects list items with links in the format: [Title](path#slug)
 * OR plain text in the format: Title
 */
function parseHeadingSections(listNode: any): HeadingHierarchy {
  const hierarchy: HeadingHierarchy = {};
  const stack: Array<{ depth: number; node: HeadingHierarchy }> = [{ depth: -1, node: hierarchy }];

  // Helper to calculate depth from list nesting
  function processListItems(items: any[], baseDepth: number, parentIsOrdered: boolean = false, startIndex: number = 1) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.type !== 'listItem') {
        continue;
      }

      // Find the paragraph content
      const itemParagraph = item.children?.find((child: any) => child.type === 'paragraph');
      if (!itemParagraph) {
        continue;
      }

      // Try to find a link first (linked format)
      const itemLink = itemParagraph?.children?.find((child: any) => child.type === 'link');

      let title = '';
      let titleMarkdown: any[] = [];
      let slug = '';

      if (itemLink) {
        // Linked format: [Title](path#slug)
        title = itemLink.children?.[0]?.value || '';
        // Strip position metadata from titleMarkdown
        titleMarkdown = stripPositions(itemLink.children || []);
        const url = itemLink.url || '';
        slug = url.split('#')[1] || '';
      } else {
        // Plain text format: extract all children (preserves formatting)
        // Strip position metadata from titleMarkdown
        titleMarkdown = stripPositions(itemParagraph.children || []);

        // Extract plain text for slug generation
        let rawTitle = itemParagraph.children
          .map((child: any) => {
            if (child.type === 'text') {
              return child.value;
            }
            if (child.type === 'inlineCode') {
              return child.value;
            }
            if ('children' in child) {
              // Recursively extract text from nested nodes
              return astNodesToMarkdown(child.children).replace(/[*`_]/g, '');
            }
            return '';
          })
          .join('')
          .trim();

        // Unescape numbered list syntax (e.g., "1\. Text" -> "1. Text")
        // This handles titles that were escaped during serialization
        rawTitle = rawTitle.replace(/^(\d+)\\\.\s/, '$1. ');

        // If this is from an ordered list, prepend the number
        if (parentIsOrdered) {
          const itemNumber = startIndex + i;
          title = `${itemNumber}. ${rawTitle}`;
          // Update titleMarkdown to include the number
          titleMarkdown = [{ type: 'text', value: title }];
        } else {
          title = rawTitle;
        }

        // Generate slug from the title (with number if applicable)
        slug = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      }

      if (title && slug && titleMarkdown.length > 0) {
        // Pop stack until we find the parent at the right depth
        while (stack.length > 0 && stack[stack.length - 1].depth >= baseDepth) {
          stack.pop();
        }

        const parent = stack[stack.length - 1].node;
        const newNode = {
          title,
          titleMarkdown,
          children: {} as HeadingHierarchy,
        };
        parent[slug] = newNode;
        stack.push({ depth: baseDepth, node: newNode.children });

        // Check for nested lists (can be ordered or unordered)
        const nestedLists = item.children?.filter((child: any) => child.type === 'list');
        for (const nestedList of nestedLists || []) {
          if (nestedList.children) {
            const nestedIsOrdered = nestedList.ordered === true;
            const nestedStart = nestedList.start || 1;
            // Always increment depth for true nesting
            processListItems(nestedList.children, baseDepth + 1, nestedIsOrdered, nestedStart);
          }
        }
      }
    }
  }

  if (listNode?.type === 'list' && listNode.children) {
    processListItems(listNode.children, 0);
  }

  return hierarchy;
} /**
 * Converts an array of page metadata into a markdown AST
 */
export function metadataToMarkdownAst(data: PagesMetadata): Root {
  const { title: mainTitle, pages } = data;
  const children: Root['children'] = [];

  // Add main title
  children.push(heading(1, mainTitle));

  // Add editable section marker
  children.push(
    comment('This file is autogenerated, but the following order can be modified') as any,
  );

  // Add page list (editable section)
  for (const page of pages) {
    const pageTitle = page.openGraph?.title || page.title || page.slug;
    const description =
      page.openGraph?.description || page.description || 'No description available';

    children.push(paragraph([text('- '), link(page.path, pageTitle), text(` - ${description}`)]));
  }

  // Add non-editable section marker
  children.push(comment('This file is autogenerated, DO NOT EDIT AFTER THIS LINE') as any);

  // Add detailed page sections (non-editable)
  for (const page of pages) {
    const pageTitle = page.openGraph?.title || page.title || page.slug;
    const description =
      page.openGraph?.description || page.description || 'No description available';
    const keywords = page.keywords || [];
    const image = page.openGraph?.images?.[0];

    // Add page heading
    children.push(heading(2, pageTitle));

    // Add description
    children.push(paragraph(description));

    // Add image if available
    if (image) {
      children.push({
        type: 'paragraph',
        children: [
          {
            type: 'image',
            url: image.url,
            alt: image.alt || pageTitle,
          },
        ],
      } as any);
    }

    // Add metadata list (keywords and sections combined)
    const hasKeywords = keywords.length > 0;
    const hasSections = page.sections && Object.keys(page.sections).length > 0;

    if (hasKeywords || hasSections) {
      const metadataListItems: any[] = [];

      if (hasKeywords) {
        metadataListItems.push({
          type: 'listItem',
          children: [paragraph(`Keywords: ${keywords.join(', ')}`)],
        });
      }

      if (hasSections && page.sections) {
        const sectionListItems = headingHierarchyToListNodes(page.sections, page.path);
        metadataListItems.push({
          type: 'listItem',
          children: [
            paragraph('Sections:'),
            {
              type: 'list',
              ordered: false,
              children: sectionListItems,
            },
          ],
        });
      }

      children.push({
        type: 'list',
        ordered: false,
        children: metadataListItems,
      } as any);
    }

    // Add read more link
    children.push(paragraph([link(page.path, 'Read more')]));
  }

  return {
    type: 'root',
    children,
  };
}

/**
 * Converts an array of page metadata into the markdown format (string)
 */
export function metadataToMarkdown(data: PagesMetadata): string {
  const { title, pages } = data;
  const lines: string[] = [];

  // Add main title
  lines.push(`# ${title}`);
  lines.push('');

  // Add editable section marker
  lines.push("[//]: # 'This file is autogenerated, but the following order can be modified'");
  lines.push('');

  // Add page list (editable section)
  for (const page of pages) {
    const pageTitle = page.openGraph?.title || page.title || page.slug;
    // Use descriptionMarkdown to preserve formatting if available
    let description: string;
    if (page.descriptionMarkdown && page.descriptionMarkdown.length > 0) {
      description = astNodesToMarkdown(page.descriptionMarkdown);
    } else {
      description = page.openGraph?.description || page.description || 'No description available';
    }
    lines.push(`- [${pageTitle}](${page.path}) - ${description}`);
  }

  lines.push('');

  // Add non-editable section marker
  lines.push("[//]: # 'This file is autogenerated, DO NOT EDIT AFTER THIS LINE'");
  lines.push('');

  // Add detailed page sections (non-editable)
  for (const page of pages) {
    const pageTitle = page.openGraph?.title || page.title || page.slug;
    // Use descriptionMarkdown to preserve formatting if available
    let description: string;
    if (page.descriptionMarkdown && page.descriptionMarkdown.length > 0) {
      description = astNodesToMarkdown(page.descriptionMarkdown);
    } else {
      description = page.openGraph?.description || page.description || 'No description available';
    }
    const keywords = page.keywords || [];
    const image = page.openGraph?.images?.[0];

    // Add page heading
    lines.push(`## ${pageTitle}`);
    lines.push('');

    // Add description
    lines.push(description);
    lines.push('');

    // Add image if available
    if (image) {
      lines.push(`![${image.alt || pageTitle}](${image.url})`);
      lines.push('');
    }

    // Add metadata list (keywords and sections)
    const hasKeywords = keywords.length > 0;
    const hasSections = page.sections && Object.keys(page.sections).length > 0;

    if (hasKeywords || hasSections) {
      if (hasKeywords) {
        lines.push(`- Keywords: ${keywords.join(', ')}`);
      }
      if (hasSections && page.sections) {
        const sectionLines = headingHierarchyToMarkdown(page.sections, page.path, 1); // Start at depth 1 for indentation
        lines.push('- Sections:');
        lines.push(sectionLines.trimEnd());
      }
      lines.push('');
    }

    // Add read more link
    lines.push(`[Read more](${page.path})`);
    lines.push('');
  }

  // Remove trailing empty line
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Parses markdown content and extracts page metadata using unified
 */
export async function markdownToMetadata(markdown: string): Promise<PagesMetadata | null> {
  const tree = unified().use(remarkParse).parse(markdown);

  let title: string | null = null;
  const pages: PageMetadata[] = [];
  let currentSection: 'header' | 'editable' | 'details' = 'header';
  let currentPage: Partial<PageMetadata> | null = null;

  // Visit all nodes in the AST
  visit(tree, (node, index, parent) => {
    // Track sections based on definition nodes (HTML-style comments)
    if (node.type === 'definition') {
      const defNode = node as DefinitionNode;
      if (defNode.title?.includes('following order can be modified')) {
        currentSection = 'editable';
        return;
      }
      if (defNode.title?.includes('DO NOT EDIT AFTER THIS LINE')) {
        currentSection = 'details';
        return;
      }
    }

    // Extract main title (H1)
    if (node.type === 'heading') {
      const headingNode = node as HeadingNode;
      if (headingNode.depth === 1) {
        title = extractPlainTextFromNode(headingNode);
        currentSection = 'header';
        return;
      }
    }

    // Parse editable list items - check if we're in a paragraph that's a child of a listItem
    if (currentSection === 'editable' && node.type === 'paragraph' && parent?.type === 'listItem') {
      const paragraphNode = node as ParagraphNode;
      if (paragraphNode.children) {
        // Look for link in the paragraph
        const linkNode = paragraphNode.children.find((child: any) => child.type === 'link') as
          | LinkNode
          | undefined;
        if (linkNode) {
          const pageTitle = extractPlainTextFromNode(linkNode);
          const path = linkNode.url;
          const slug = extractSlugFromPath(path);

          // Only extract slug, path, and title from the editable list
          // The description will be filled in from the details section
          pages.push({
            slug,
            path,
            title: pageTitle,
            description: 'No description available', // Will be updated from details section
            openGraph: {
              title: pageTitle,
              description: 'No description available', // Will be updated from details section
            },
          });
        }
      }
      return;
    }

    // Parse detail sections
    if (currentSection === 'details') {
      // Start of a new page section (H2)
      if (node.type === 'heading') {
        const headingNode = node as HeadingNode;
        if (headingNode.depth === 2) {
          // Save previous page if exists
          if (currentPage?.slug) {
            const savedSlug = currentPage.slug;
            const foundIndex = pages.findIndex((c) => c.slug === savedSlug);
            if (foundIndex !== -1) {
              pages[foundIndex] = {
                ...pages[foundIndex],
                ...currentPage,
              } as PageMetadata;
            }
          }

          const pageTitle = extractPlainTextFromNode(headingNode);
          // Find the page in the existing pages array by matching the title
          const existingPage = pages.find((p) => p.title === pageTitle);
          if (existingPage) {
            // Start updating this existing page
            currentPage = { slug: existingPage.slug, title: pageTitle };
          } else {
            // If no matching page found, create a new one with slug from title
            const slug = titleToSlug(pageTitle);
            currentPage = { slug, title: pageTitle };
          }
          return;
        }
      }

      // Parse description (first paragraph after title) and keywords/sections
      if (currentPage && node.type === 'paragraph') {
        const paragraphNode = node as ParagraphNode;
        const paragraphText = extractTextFromNode(paragraphNode);

        // Check if we're in a list item
        if (parent?.type === 'listItem') {
          // Parse keywords
          if (paragraphText.startsWith('Keywords:')) {
            const keywordsText = paragraphText.replace('Keywords:', '').trim();
            currentPage.keywords = keywordsText.split(',').map((k) => k.trim());
            return;
          }

          // Parse sections - now they're in a nested list within the same parent list item
          if (paragraphText.startsWith('Sections:')) {
            // Find the nested list within this list item
            const listItem = parent as any;
            const nestedList = listItem.children?.find((child: any) => child.type === 'list');

            if (nestedList && nestedList.children) {
              currentPage.sections = parseHeadingSections(nestedList);
            } else {
              currentPage.sections = {};
            }
            return;
          }
        }

        // Skip read more links
        if (paragraphText.startsWith('[Read more]')) {
          return;
        }

        // Parse description (first paragraph after title, not in a list)
        if (!currentPage.description && parent?.type !== 'listItem') {
          currentPage.description = paragraphText;
          // Store the AST nodes with position info stripped for clean serialization
          if (paragraphNode.children) {
            currentPage.descriptionMarkdown = stripPositions(paragraphNode.children);
          }
          if (!currentPage.openGraph) {
            currentPage.openGraph = {};
          }
          currentPage.openGraph.description = paragraphText;
          return;
        }
      }

      // Parse image
      if (currentPage && node.type === 'image') {
        const imageNode = node as ImageNode;
        if (!currentPage.openGraph) {
          currentPage.openGraph = {};
        }
        currentPage.openGraph.images = [
          {
            url: imageNode.url,
            width: 800,
            height: 600,
            alt: imageNode.alt || currentPage.title || currentPage.slug || '',
          },
        ];
        return;
      }
    }
  });

  // Save last page if exists
  if (currentPage) {
    const partialPage = currentPage as Partial<PageMetadata>;
    if (partialPage.slug) {
      const foundIndex = pages.findIndex((c) => c.slug === partialPage.slug);
      if (foundIndex !== -1) {
        pages[foundIndex] = {
          ...pages[foundIndex],
          ...partialPage,
        } as PageMetadata;
      }
    }
  }

  if (!title) {
    return null;
  }

  return {
    title,
    pages,
  };
}

/**
 * Extracts plain text content from any mdast node without markdown formatting
 * Used for titles and other places where we don't want markdown syntax
 */
function extractPlainTextFromNode(node: any): string {
  if (node.type === 'text') {
    return node.value;
  }
  if (node.type === 'inlineCode') {
    return node.value;
  }
  if (node.children) {
    const extractedText = node.children
      .map((child: any) => extractPlainTextFromNode(child))
      .join('');
    // For paragraph nodes, replace newlines with spaces and normalize whitespace
    if (node.type === 'paragraph') {
      return extractedText.replace(/\s+/g, ' ').trim();
    }
    return extractedText;
  }
  return '';
}

/**
 * Extracts text content from any mdast node
 * Preserves markdown formatting like inline code and links
 */
function extractTextFromNode(node: any): string {
  if (node.type === 'text') {
    return node.value;
  }
  if (node.type === 'inlineCode') {
    return `\`${node.value}\``;
  }
  if (node.type === 'link') {
    const linkText = node.children.map((child: any) => extractTextFromNode(child)).join('');
    return `[${linkText}](${node.url})`;
  }
  if (node.type === 'emphasis') {
    const emphasisText = node.children.map((child: any) => extractTextFromNode(child)).join('');
    return `*${emphasisText}*`;
  }
  if (node.type === 'strong') {
    const strongText = node.children.map((child: any) => extractTextFromNode(child)).join('');
    return `**${strongText}**`;
  }
  if (node.children) {
    const extractedText = node.children.map((child: any) => extractTextFromNode(child)).join('');
    // For paragraph nodes, replace newlines with spaces and normalize whitespace
    if (node.type === 'paragraph') {
      return extractedText.replace(/\s+/g, ' ').trim();
    }
    return extractedText;
  }
  return '';
}

/**
 * Extracts slug from a path like './button/page.mdx' -> 'button'
 */
function extractSlugFromPath(path: string): string {
  const withoutExtension = path.replace(/\.mdx?$/, '');
  const parts = withoutExtension.split('/').filter(Boolean);
  // Remove '.' and 'page' if present
  return parts.filter((p) => p !== '.' && p !== 'page').pop() || '';
}

/**
 * Converts a title to a slug (simple version)
 */
function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
