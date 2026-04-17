import type { Root as HastRoot, Element, Text, ElementContent } from 'hast';
import { visit } from 'unist-util-visit';

/**
 * Maps tag-name span classes to their wrapper class.
 * - pl-ent (HTML entity tag like div, span) → di-ht (HTML tag)
 * - pl-c1 (syntax constant like Box, Stack) → di-jt (JSX tag)
 */
const TAG_NAME_CLASS_MAP: Record<string, string> = {
  'pl-ent': 'di-ht',
  'pl-c1': 'di-jt',
};

/**
 * Map of class → text values that should be reclassified to a different class.
 * For example, `function` is sometimes classified as `pl-en` (entity name)
 * but should be styled as `pl-k` (keyword).
 */
const CLASS_RECLASSIFICATIONS: Record<string, Record<string, string>> = {
  'pl-en': {
    function: 'pl-k',
  },
};

/**
 * Returns the wrapper class for a tag-name element, or undefined if not a tag name.
 */
function getTagWrapperClass(element: Element): string | undefined {
  const className = element.properties?.className;
  if (!Array.isArray(className)) {
    return undefined;
  }
  for (const cls of className) {
    if (typeof cls === 'string' && TAG_NAME_CLASS_MAP[cls]) {
      return TAG_NAME_CLASS_MAP[cls];
    }
  }
  return undefined;
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
 * Wraps HTML/JSX tag patterns in a wrapper span that groups the opening bracket,
 * tag-name span, and closing bracket into one element.
 *
 * - HTML tags (pl-ent) get `<span class="di-ht">` (HTML tag)
 * - JSX component tags (pl-c1) get `<span class="di-jt">` (JSX tag)
 *
 * The original `pl-*` spans are preserved intact inside the wrapper — no
 * semantic information is destroyed.
 *
 * This function processes nodes iteratively, but when text is split during
 * enhancement, it re-inserts the remaining text back into the processing queue
 * so consecutive tags like `<div><span>` are all enhanced.
 */
function enhanceTagBrackets(children: ElementContent[]): ElementContent[] {
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
      const wrapperClass = match ? getTagWrapperClass(nextElement) : undefined;

      if (wrapperClass) {
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

          // Build the wrapper children: bracket text + original span + closing text
          const afterText = (afterSpan as Text).value;
          const contentBeforeClose = afterText.slice(0, closingBracket.position);

          const wrapperChildren: ElementContent[] = [
            { type: 'text', value: prefix },
            nextElement,
            { type: 'text', value: contentBeforeClose + closingBracket.suffix },
          ];

          const wrapperSpan: Element = {
            type: 'element',
            tagName: 'span',
            properties: { className: [wrapperClass] },
            children: wrapperChildren,
          };
          newChildren.push(wrapperSpan);

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
 * Gets the text content of an element's first text child.
 */
function getFirstTextValue(element: Element): string | undefined {
  const firstChild = element.children[0];
  if (firstChild && firstChild.type === 'text') {
    return firstChild.value;
  }
  return undefined;
}

/**
 * Reclassifies spans whose class + text content indicate a wrong token type.
 * For example, `<span class="pl-en">function</span>` is reclassified to
 * `<span class="pl-k">function</span>` because "function" is a keyword.
 */
function reclassifyTokens(children: ElementContent[]): void {
  for (const child of children) {
    if (child.type !== 'element' || child.tagName !== 'span') {
      continue;
    }

    const className = child.properties?.className;
    if (!Array.isArray(className)) {
      continue;
    }

    const text = getFirstTextValue(child);
    if (!text) {
      continue;
    }

    for (let i = 0; i < className.length; i += 1) {
      const cls = className[i];
      if (typeof cls === 'string' && CLASS_RECLASSIFICATIONS[cls]?.[text]) {
        className[i] = CLASS_RECLASSIFICATIONS[cls][text];
      }
    }
  }
}

/**
 * A rehype plugin that enhances inline code elements in two ways:
 *
 * 1. **Tag bracket wrapping**: Wraps HTML/JSX tag patterns (opening bracket,
 *    tag-name span, closing bracket) in a wrapper span. HTML tags (`pl-ent`)
 *    get `<span class="di-ht">`, JSX component tags (`pl-c1`) get
 *    `<span class="di-jt">`. The original `pl-*` spans are preserved
 *    inside — no semantic information is destroyed.
 *
 * 2. **Token reclassification**: Corrects misidentified token classes,
 *    e.g., `function` marked as `pl-en` is changed to `pl-k` (keyword).
 *
 * Transforms patterns like:
 * `<code>&lt;<span class="pl-ent">div</span>&gt;</code>`
 *
 * Into:
 * `<code><span class="di-ht">&lt;<span class="pl-ent">div</span>&gt;</span></code>`
 *
 * **Important**: This plugin should run after syntax highlighting plugins
 * (like transformHtmlCodeInline) as it modifies the structure
 * of highlighted elements.
 *
 * @returns A unified transformer function
 */
export default function enhanceCodeInline() {
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

      // Wrap angle brackets into their tag name spans
      node.children = enhanceTagBrackets(node.children);

      // Reclassify misidentified tokens (e.g., pl-en "function" → pl-k)
      reclassifyTokens(node.children);
    });
  };
}
