/**
 * createMarkdownNodes.ts - Helper functions for creating MD AST nodes
 *
 * This module provides utility functions to create nodes for Markdown
 * abstract syntax trees, making transformer code more readable and maintainable.
 */

import type {
  PhrasingContent,
  Text,
  Paragraph,
  Heading,
  Code,
  InlineCode,
  Table,
  TableRow,
  TableCell,
  Emphasis,
  Strong,
  Definition,
} from 'mdast';

/**
 * Create a text node
 * @param value - The text content
 * @returns A text node
 */
export function text(value: string): Text {
  return {
    type: 'text',
    value: value || '',
  };
}

type Child = PhrasingContent | string;

/**
 * Helper to normalize children (handles string, node, or array)
 * @param children - Child content
 * @returns Normalized array of nodes
 */
function normalizeChildren(children: Child | Child[]): PhrasingContent[] {
  // Handle empty or undefined
  if (!children) {
    return [];
  }

  // Convert to array if not already
  const childArray = Array.isArray(children) ? children : [children];

  // Convert strings to text nodes
  return childArray.map((child) => (typeof child === 'string' ? text(child) : child));
}

/**
 * Create a paragraph node
 * @param children - Child node, string, or array of nodes/strings
 * @returns A paragraph node
 */
export function paragraph(children: Child | Child[]): Paragraph {
  return {
    type: 'paragraph',
    children: normalizeChildren(children),
  };
}

/**
 * Create an emphasis (italic) node
 * @param children - Child node, string, or array of nodes/strings
 * @returns An emphasis node
 */
export function emphasis(children: Child | Child[]): Emphasis {
  return {
    type: 'emphasis',
    children: normalizeChildren(children),
  };
}

/**
 * Create a strong (bold) node
 * @param children - Child node, string, or array of nodes/strings
 * @returns A strong node
 */
export function strong(children: Child | Child[]): Strong {
  return {
    type: 'strong',
    children: normalizeChildren(children),
  };
}

/**
 * Create a heading node
 * @param depth - Heading level (1-6)
 * @param children - Child node, string, or array of nodes/strings
 * @returns A heading node
 */
export function heading(depth: 1 | 2 | 3 | 4 | 5 | 6, children: Child | Child[]): Heading {
  return {
    type: 'heading',
    depth: depth || 1,
    children: normalizeChildren(children),
  };
}

/**
 * Create a code block node
 * @param {string} value - Code content
 * @param {string} lang - Language for syntax highlighting
 * @returns {Object} A code node
 */
export function code(value: string, lang?: string): Code {
  return {
    type: 'code',
    lang: lang || null,
    value: value || '',
  };
}

/**
 * Create an inline code node
 * @param {string} value - Code content
 * @returns {Object} An inline code node
 */
export function inlineCode(value: string): InlineCode {
  return {
    type: 'inlineCode',
    value: value || '',
  };
}

/**
 * Calculate the visual length of phrasing content
 * (e.g., "One `two` three" has visual length of ~13, or ~9 if excludeFormatting=true)
 * @param node - The phrasing content node
 * @param excludeFormatting - If true, don't count formatting characters like backticks, brackets, etc.
 *                            This allows "`false`" and "false" to both be treated as length 5.
 */
function getPhrasingContentLength(node: PhrasingContent, excludeFormatting = false): number {
  switch (node.type) {
    case 'text':
      return node.value.length;
    case 'inlineCode':
      // Backticks add 2 chars, but exclude them if normalizing
      return node.value.length + (excludeFormatting ? 0 : 2);
    case 'emphasis':
      // Asterisks/underscores add chars, but exclude them if normalizing
      return (node.children || []).reduce(
        (sum, child) => sum + getPhrasingContentLength(child, excludeFormatting),
        excludeFormatting ? 0 : 2, // *text* or _text_ adds 2 chars
      );
    case 'strong':
      // Double asterisks/underscores add chars, but exclude them if normalizing
      return (node.children || []).reduce(
        (sum, child) => sum + getPhrasingContentLength(child, excludeFormatting),
        excludeFormatting ? 0 : 4, // **text** or __text__ adds 4 chars
      );
    case 'delete':
      // Tildes add chars, but exclude them if normalizing
      return (node.children || []).reduce(
        (sum, child) => sum + getPhrasingContentLength(child, excludeFormatting),
        excludeFormatting ? 0 : 4, // ~~text~~ adds 4 chars
      );
    case 'link': {
      // [text](url) format adds chars, but exclude them if normalizing
      const childrenLength = (node.children || []).reduce(
        (sum, child) => sum + getPhrasingContentLength(child, excludeFormatting),
        0,
      );
      return excludeFormatting ? childrenLength : childrenLength + 4 + (node.url?.length || 0); // [](url) adds 4 + url length
    }
    case 'image': {
      // ![alt](url) format
      const altLength = (node.alt || '').length;
      return excludeFormatting ? altLength : altLength + 5 + (node.url?.length || 0); // ![](url) adds 5 + url length
    }
    case 'break':
      return 0;
    default:
      return 0;
  }
}

/**
 * Creates a table cell node
 * @param content - Cell content
 * @param widthIncrements - Optional width increment for padding alignment
 * @param excludeFormatting - If true, don't count formatting chars when calculating width
 * @returns Table cell node
 */
function tableCell(
  content: Child | Child[],
  widthIncrements?: number,
  excludeFormatting = true,
): TableCell {
  const children = normalizeChildren(content);

  if (widthIncrements) {
    // Calculate total visual length of all content
    const totalLength = children.reduce(
      (sum, child) => sum + getPhrasingContentLength(child, excludeFormatting),
      0,
    );

    // Calculate padding needed
    const paddingNeeded = Math.ceil(totalLength / widthIncrements) * widthIncrements - totalLength;

    // Add padding as trailing spaces to the last text node, or create a new text node
    if (paddingNeeded > 0) {
      const spaces = new Array(paddingNeeded).fill(' ').join('');

      // Find the last text node and append spaces (reverse search)
      let lastTextIndex = -1;
      for (let i = children.length - 1; i >= 0; i -= 1) {
        if (children[i].type === 'text') {
          lastTextIndex = i;
          break;
        }
      }

      if (lastTextIndex >= 0) {
        const lastText = children[lastTextIndex] as Text;
        children[lastTextIndex] = { ...lastText, value: `${lastText.value}${spaces}` };
      } else {
        // No text node found, add a new text node with just spaces
        children.push(text(spaces));
      }
    }
  }

  return {
    type: 'tableCell',
    children,
  };
}

/**
 * Creates a table row node
 * @param cells - Array of cell contents
 * @returns Table row node
 */
function tableRow(cells: (Child | Child[])[], widthIncrements?: number): TableRow {
  return {
    type: 'tableRow',
    children: cells.map((cell) => tableCell(cell, widthIncrements)),
  };
}

/**
 * Creates a markdown table node (GFM)
 * @param {Array<string|Object>} headers - Array of header strings or nodes
 * @param {Array<Array<string|Object>>} rows - Array of row data, each row is an array of cell content
 * @param {Array<string>} [alignment] - Optional array of alignments ('left', 'center', 'right') for each column
 * @param {number} [widthIncrements] - Optional value to control the increments that tables expand for cleaner
 * @returns {Object} A table node
 */
export function table(
  headers: (Child | Child[])[],
  rows: (Child | Child[])[][],
  alignment: string[] | null = null,
  widthIncrements: number = 7,
): Table {
  // Convert alignment strings to AST format
  const align: ('left' | 'right' | 'center' | null)[] = headers.map((_: any, index: number) => {
    if (!alignment || !alignment[index]) {
      return null;
    }

    switch (alignment[index]) {
      case 'center':
        return 'center';
      case 'right':
        return 'right';
      default:
        return 'left';
    }
  });

  // Create header row
  const headerRow = tableRow(headers);

  // Create data rows - rows is actually an array of arrays
  const dataRows = rows.map((row) => tableRow(row, widthIncrements));

  // Return table node
  return {
    type: 'table',
    align,
    children: [headerRow, ...dataRows],
  };
}

/**
 * Create a comment node. Comment text will not be rendered in HTML output.
 * @param value - Comment text
 * @returns A comment node
 */
export function comment(value: string, ref?: string): Definition {
  return {
    type: 'definition',
    identifier: '//',
    url: ref || '#',
    title: value,
  };
}

/**
 * Create a link node
 * @param url - The URL to link to
 * @param children - Child node, string, or array of nodes/strings
 * @param title - Optional title attribute
 * @returns A link node
 */
export function link(url: string, children: Child | Child[], title?: string): PhrasingContent {
  return {
    type: 'link',
    url,
    title,
    children: normalizeChildren(children),
  };
}
