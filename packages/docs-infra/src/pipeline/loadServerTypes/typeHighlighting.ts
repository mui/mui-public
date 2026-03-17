/**
 * Type highlighting utilities for converting plain text types to syntax-highlighted HAST.
 *
 * These functions are used in the loadServerTypes pipeline after highlightTypes()
 * to convert plain text type strings into syntax-highlighted HAST with proper
 * formatting for display in documentation.
 */

import { unified } from 'unified';
import type { Root as HastRoot } from 'hast';
import transformHtmlCodeInlineHighlighted from '../transformHtmlCodeInlineHighlighted';
import { starryNightGutter } from '../parseSource/addLineGutters';

/**
 * Options for formatting inline types as HAST.
 */
export interface FormatInlineTypeOptions {
  /**
   * Maximum line width before union types in shortType fields are split across multiple lines.
   * When a union type exceeds this width, it will be formatted with each
   * member on a separate line with leading pipe characters.
   * @default 40
   */
  shortTypeUnionPrintWidth?: number;
  /**
   * Maximum line width before union types in defaultValue fields are split across multiple lines.
   * When a union type exceeds this width, it will be formatted with each
   * member on a separate line with leading pipe characters.
   * @default 40
   */
  defaultValueUnionPrintWidth?: number;
  /**
   * Maximum line width for Prettier formatting of type definitions.
   * @default 60
   */
  typePrintWidth?: number;
  /**
   * Maximum line width for Prettier formatting of top-level types that
   * aren't individual properties, such as whole return types and raw type definitions.
   * Note: Prettier is already run once during `syncTypes` using the project's configured width.
   * This option re-runs Prettier at a different width and should only be used when
   * the display width in the browser differs from the project's configuration.
   * When not specified, the additional Prettier pass is skipped.
   */
  topLevelTypePrintWidth?: number;
}

/** Default width for splitting union types across multiple lines */
export const DEFAULT_UNION_PRINT_WIDTH = 40;

/** Default width for Prettier formatting of type definitions */
export const DEFAULT_TYPE_PRINT_WIDTH = 60;

/**
 * Splits union types across multiple lines.
 *
 * This function processes HAST nodes containing syntax-highlighted union types and
 * reformats them with each union member on a separate line, prefixed with a pipe character.
 * Only top-level pipes are split (not those inside parentheses or braces).
 *
 * Matches the behavior of TableCode.tsx in base-ui docs:
 * - Groups content by top-level pipe separators
 * - Adds a leading `| ` before the first group
 * - Adds `<br>` + `| ` before subsequent groups
 * - Removes original pipe nodes (they're replaced by the new styled pipes)
 *
 * @param hast - The HAST root containing syntax-highlighted type nodes
 * @returns A new HAST root with multiline formatting applied
 */
export function formatMultilineUnionHast(hast: HastRoot): HastRoot {
  // Get the code element
  const codeElement = hast.children[0];
  if (!codeElement || codeElement.type !== 'element') {
    return hast;
  }

  // Helper to get text content from a node (needed for depth tracking)
  const getTextContent = (node: any): string => {
    if (node.type === 'text') {
      return node.value || '';
    }
    if (node.children) {
      return node.children.map(getTextContent).join('');
    }
    return '';
  };

  const children = (codeElement as any).children || [];

  // Group children by top-level pipes (matching TableCode.tsx behavior)
  const unionGroups: any[][] = [[]];
  let parenDepth = 0;
  let braceDepth = 0;
  let groupIndex = 0;

  children.forEach((child: any, index: number) => {
    const nodeText = getTextContent(child);

    // Track depth changes
    for (const char of nodeText) {
      if (char === '(') {
        parenDepth += 1;
      } else if (char === ')') {
        parenDepth -= 1;
      } else if (char === '{') {
        braceDepth += 1;
      } else if (char === '}') {
        braceDepth -= 1;
      }
    }

    // Check if this node contains only a pipe at top level
    const trimmedText = nodeText.trim();
    const isTopLevelPipe = trimmedText === '|' && parenDepth <= 0 && braceDepth <= 0 && index !== 0;

    if (isTopLevelPipe) {
      // Skip the pipe node and start a new group (matching TableCode behavior)
      unionGroups.push([]);
      groupIndex += 1;
      return;
    }

    unionGroups[groupIndex].push(child);
  });

  // If we only have one group, no splitting needed
  if (unionGroups.length <= 1) {
    return hast;
  }

  // Build enhanced children with pipes and line breaks (matching TableCode.tsx)
  const enhancedChildren: any[] = [];
  const pipeSpan = {
    type: 'element',
    tagName: 'span',
    properties: { className: ['pl-k'] },
    children: [{ type: 'text', value: '| ' }],
  };

  unionGroups.forEach((group, idx) => {
    if (idx === 0) {
      // Leading pipe for first group
      enhancedChildren.push({ ...pipeSpan });
    } else {
      // Newline plus pipe for subsequent groups
      enhancedChildren.push({ type: 'element', tagName: 'br', properties: {}, children: [] });
      enhancedChildren.push({ ...pipeSpan });
    }
    enhancedChildren.push(...group);
  });

  // Reconstruct the HAST with new children
  return {
    type: 'root',
    children: [
      {
        ...codeElement,
        children: enhancedChildren,
      },
    ],
  } as HastRoot;
}

/**
 * Formats an inline type string with syntax highlighting.
 *
 * This function transforms type strings (like `string`, `number | null`, etc.) into
 * syntax-highlighted HAST nodes. It ensures proper TypeScript context by prefixing
 * the type with `type _ =` before highlighting, then removes the prefix from the result.
 *
 * @param typeText - The type string to format (e.g., "string | number")
 * @param unionPrintWidth - Optional width threshold for multiline union formatting.
 *                          When set, unions exceeding this width are split across lines.
 * @returns A promise that resolves to a HAST root containing highlighted nodes
 *
 * @example
 * ```ts
 * await formatInlineTypeAsHast('string | number')
 * // Returns HAST nodes with syntax highlighting for "string | number"
 *
 * await formatInlineTypeAsHast('"a" | "b" | "c" | "d" | "e"', 20)
 * // Returns HAST nodes with multiline formatting for long unions
 * ```
 */
export async function formatInlineTypeAsHast(
  typeText: string,
  unionPrintWidth?: number,
): Promise<HastRoot> {
  // Construct HAST with a code element
  // Add dataHighlightingPrefix so the plugin can temporarily wrap the type in valid syntax
  const hast: HastRoot = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: {
          className: ['language-ts'],
          dataHighlightingPrefix: 'type _ = ',
        },
        children: [{ type: 'text', value: typeText }],
      },
    ],
  };

  // Apply inline syntax highlighting
  const processor = unified().use(transformHtmlCodeInlineHighlighted).freeze();

  let result = (await processor.run(hast)) as HastRoot;

  // Apply multiline union formatting if threshold is exceeded
  // Check against original text to avoid extracting text from HAST
  if (
    unionPrintWidth !== undefined &&
    typeText.includes('|') &&
    typeText.length > unionPrintWidth
  ) {
    result = formatMultilineUnionHast(result);
  }

  return result;
}

/**
 * Wraps a HAST produced by formatInlineTypeAsHast in a <pre> element.
 * Converts root > code > [spans] into root > pre > code > [line-wrapped spans].
 *
 * This also:
 * - Removes the `data-inline` attribute that was added during inline highlighting
 *   (since the code is no longer inline once wrapped in <pre>)
 * - Wraps each line of content in <span class="line"> elements so that
 *   CSS rules like `.Code .line { white-space: pre }` apply correctly
 */
export function wrapInlineTypeInPre(hast: HastRoot): HastRoot {
  const codeElement = hast.children[0];
  if (!codeElement || codeElement.type !== 'element' || codeElement.tagName !== 'code') {
    return hast;
  }

  // Remove data-inline since this code is now inside a <pre>
  if (codeElement.properties) {
    delete codeElement.properties.dataInline;
  }

  // Wrap children in .line spans using starryNightGutter (same as formatDetailedTypeAsHast)
  const tempRoot: HastRoot = {
    type: 'root',
    children: codeElement.children,
  };
  starryNightGutter(tempRoot);
  codeElement.children = tempRoot.children as typeof codeElement.children;

  return {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [codeElement],
      },
    ],
  };
}

/**
 * Formats TypeScript type text as HAST with full syntax highlighting in a code block.
 * This is used for detailed/expanded type displays (equivalent to triple backticks in MDX).
 * Unlike formatInlineTypeAsHast which uses <code>, this creates a <pre><code> structure
 * and also includes line numbers via starryNightGutter.
 */
export async function formatDetailedTypeAsHast(typeText: string): Promise<HastRoot> {
  // Construct HAST with a pre > code structure for block-level display
  const hast: HastRoot = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: {
              className: ['language-ts'],
              dataHighlightingPrefix: 'type _ = ',
            },
            children: [{ type: 'text', value: typeText }],
          },
        ],
      },
    ],
  };

  // Apply inline syntax highlighting (with includePreElements to process pre>code)
  const processor = unified()
    .use(transformHtmlCodeInlineHighlighted, { includePreElements: true })
    .freeze();

  const result = (await processor.run(hast)) as HastRoot;

  // Add line gutters to the highlighted code
  const preElement = result.children[0];
  if (preElement && preElement.type === 'element' && preElement.tagName === 'pre') {
    const codeElement = preElement.children[0];
    if (codeElement && codeElement.type === 'element' && codeElement.tagName === 'code') {
      // Create a temporary root with the code element's children for starryNightGutter
      const tempRoot: HastRoot = {
        type: 'root',
        children: codeElement.children,
      };
      // Apply line gutters (mutates tempRoot in place)
      starryNightGutter(tempRoot);
      // Put the guttered children back into the code element
      codeElement.children = tempRoot.children as typeof codeElement.children;
    }
  }

  return result;
}

/**
 * Determines whether a property should display its full type definition or a simplified version.
 *
 * Properties with complex types (unions, callbacks, etc.) benefit from expandable detailed views,
 * while simple types (string, number, boolean) can be shown inline without expansion.
 *
 * @param name - The property name (used for special cases like className, render, event handlers)
 * @param type - The plain text type string to analyze
 * @returns true if the property should have an expandable detailed type view
 */
export function shouldShowDetailedType(name: string, type: string | undefined): boolean {
  // Event handlers and getters typically have complex function signatures
  if (/^(on|get)[A-Z].*/.test(name)) {
    return true;
  }

  if (type === undefined || type === null) {
    return false;
  }

  // className can be string or function, show details
  if (name === 'className') {
    return true;
  }

  // render prop can be ReactElement or function, show details
  if (name === 'render') {
    return true;
  }

  // Simple types and short unions don't need expansion
  if (
    name.endsWith('Ref') ||
    name === 'children' ||
    type === 'boolean' ||
    type === 'string' ||
    type === 'number' ||
    type.indexOf(' | ') === -1 ||
    (type.split('|').length < 3 && type.length < 30)
  ) {
    return false;
  }

  // Complex unions benefit from detailed expansion
  return true;
}

/**
 * Gets the short representation of a type for display in tables.
 *
 * Returns a simplified type string for complex types (e.g., "Union", "function").
 * Simple types like `string`, `number`, `boolean` return undefined (no shortening needed).
 *
 * @param name - The property name (used for special cases like className, style, render, event handlers)
 * @param typeText - The plain text type string to analyze
 * @returns A short type string, or undefined if no shortening is needed
 */
export function getShortTypeString(name: string, typeText: string): string | undefined {
  // Event handlers and getters show as "function"
  if (/^(on|get)[A-Z].*/.test(name)) {
    return 'function';
  }

  // className can be string or function
  if (name === 'className') {
    return 'string | function';
  }

  // style can be React.CSSProperties or function
  if (name === 'style') {
    return 'React.CSSProperties | function';
  }

  // render can be ReactElement or function
  if (name === 'render') {
    return 'ReactElement | function';
  }

  // Complex unions show as "Union"
  if (shouldShowDetailedType(name, typeText)) {
    return 'Union';
  }

  // Simple types don't need a short version
  return undefined;
}
