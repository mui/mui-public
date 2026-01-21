import type { Root as HastRoot, Element, Text, ElementContent } from 'hast';
import { visit } from 'unist-util-visit';

/**
 * Classes that indicate HTML entity tags which should be enhanced.
 * - pl-ent: HTML entity tag (e.g., div, span)
 * - pl-c1: Syntax constant (e.g., React components like Box, Stack)
 */
const ENHANCEABLE_CLASSES = ['pl-ent', 'pl-c1'];

/**
 * Checks if an element has any of the enhanceable classes.
 */
function hasEnhanceableClass(element: Element): boolean {
  const className = element.properties?.className;
  if (!Array.isArray(className)) {
    return false;
  }
  return className.some((c) => typeof c === 'string' && ENHANCEABLE_CLASSES.includes(c));
}

/**
 * Checks if a text node ends with '<' or '</' (opening bracket for HTML tag).
 */
function endsWithOpenBracket(text: string): { match: boolean; prefix: string } {
  if (text.endsWith('</')) {
    return { match: true, prefix: '</' };
  }
  if (text.endsWith('<')) {
    return { match: true, prefix: '<' };
  }
  return { match: false, prefix: '' };
}

/**
 * Finds a closing bracket pattern in text.
 * Supports:
 * - `>` for normal tags
 * - `/>` for self-closing tags without space
 * - ` />` for self-closing tags with space
 *
 * Returns the position and the matched suffix, or null if not found.
 * For tags with attributes like `<Box flag />`, this finds the closing bracket
 * anywhere in the text, not just at the start.
 */
function findClosingBracket(text: string): { position: number; suffix: string } | null {
  // Look for self-closing patterns first (they're more specific)
  const selfClosingWithSpace = text.indexOf(' />');
  const selfClosingNoSpace = text.indexOf('/>');
  const normalClose = text.indexOf('>');

  // Find the earliest closing bracket
  const candidates: Array<{ position: number; suffix: string }> = [];

  if (selfClosingWithSpace !== -1) {
    candidates.push({ position: selfClosingWithSpace, suffix: ' />' });
  }
  if (selfClosingNoSpace !== -1) {
    candidates.push({ position: selfClosingNoSpace, suffix: '/>' });
  }
  if (normalClose !== -1) {
    candidates.push({ position: normalClose, suffix: '>' });
  }

  if (candidates.length === 0) {
    return null;
  }

  // Return the earliest match
  candidates.sort((a, b) => a.position - b.position);
  return candidates[0];
}

/**
 * Enhances the children of a code element by wrapping HTML tag brackets
 * into syntax highlighting spans.
 *
 * This function processes nodes iteratively, but when text is split during
 * enhancement, it re-inserts the remaining text back into the processing queue
 * so consecutive tags like `<div><span>` are all enhanced.
 */
function enhanceChildren(children: ElementContent[]): ElementContent[] {
  // Create a working queue from the original children
  const queue: ElementContent[] = [...children];
  const newChildren: ElementContent[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    // Look for pattern: text ending with < or </, followed by span with enhanceable class
    if (current.type === 'text' && queue.length > 0 && queue[0].type === 'element') {
      const textNode = current;
      const nextElement = queue[0] as Element;

      const { match, prefix } = endsWithOpenBracket(textNode.value);

      if (match && hasEnhanceableClass(nextElement)) {
        // Check if there's a closing bracket after the span
        const afterSpan = queue[1];
        const closingBracket =
          afterSpan && afterSpan.type === 'text'
            ? findClosingBracket((afterSpan as Text).value)
            : null;

        if (closingBracket) {
          // Add the text before the < (if any)
          const textBeforeBracket = textNode.value.slice(0, -prefix.length);
          if (textBeforeBracket) {
            newChildren.push({ type: 'text', value: textBeforeBracket });
          }

          // Create enhanced span with brackets included
          // Include any attributes/content between the tag name and closing bracket
          const afterText = (afterSpan as Text).value;
          const contentBeforeClose = afterText.slice(0, closingBracket.position);
          const enhancedSpan: Element = {
            type: 'element',
            tagName: 'span',
            properties: { ...nextElement.properties },
            children: [
              { type: 'text', value: prefix },
              ...nextElement.children,
              { type: 'text', value: contentBeforeClose + closingBracket.suffix },
            ],
          };
          newChildren.push(enhancedSpan);

          // Remove the span and the text with > from the queue
          queue.shift(); // Remove the span
          queue.shift(); // Remove the text with >

          // If there's remaining text after the closing bracket, re-insert it at the front of the queue
          // so it can be processed for the next pattern (e.g., consecutive tags)
          const textAfterBracket = afterText.slice(
            closingBracket.position + closingBracket.suffix.length,
          );
          if (textAfterBracket) {
            queue.unshift({ type: 'text', value: textAfterBracket });
          }

          continue;
        }
      }
    }

    // No enhancement needed, keep the node as is
    newChildren.push(current);
  }

  return newChildren;
}

/**
 * A rehype plugin that enhances inline code elements by wrapping HTML tags
 * (including their angle brackets) into syntax highlighting spans.
 *
 * Transforms patterns like:
 * `<code>&lt;<span class="pl-ent">div</span>&gt;</code>`
 *
 * Into:
 * `<code><span class="pl-ent">&lt;div&gt;</span></code>`
 *
 * This allows styling the entire HTML tag (including brackets) as one unit,
 * improving readability for inline code snippets.
 *
 * **Important**: This plugin should run after syntax highlighting plugins
 * (like transformHtmlCodeInlineHighlighted) as it modifies the structure
 * of highlighted elements.
 *
 * @returns A unified transformer function
 */
export default function enhanceCodeInlineElements() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element, _index, parent) => {
      // Only process code elements
      if (node.tagName !== 'code') {
        return;
      }

      // Skip if this is inside a pre element (handled separately by block code plugins)
      if (parent?.type === 'element' && 'tagName' in parent && parent.tagName === 'pre') {
        return;
      }

      // Skip if no children
      if (!node.children || node.children.length === 0) {
        return;
      }

      // Process children and replace with enhanced version
      node.children = enhanceChildren(node.children);
    });
  };
}
