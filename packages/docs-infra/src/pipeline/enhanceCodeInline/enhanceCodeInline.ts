import type { Root as HastRoot, Element, Text, ElementContent } from 'hast';
import { visit } from 'unist-util-visit';
import { getShallowTextContent } from '../loadServerTypes/hastTypeUtils';
import { getLanguageCapabilities } from '../enhanceCodeTypes/getLanguageCapabilities';
import { BUILT_IN_TYPES } from '../parseSource/extendSyntaxTokens';

/**
 * Maps tag-name span classes to their wrapper class.
 * - pl-ent (HTML entity tag like div, span) → di-ht (HTML tag)
 * - pl-c1 (syntax constant like Box, Stack) → di-jt (JSX tag)
 *
 * When the element also has `di-jsx`, the wrapper is always `di-jt`.
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
 * If the element has `di-jsx`, always returns `di-jt` (JSX component tag).
 */
function getTagWrapperClass(element: Element): string | undefined {
  const className = element.properties?.className;
  if (!Array.isArray(className)) {
    return undefined;
  }
  let baseWrapper: string | undefined;
  let hasDiJsx = false;
  for (const cls of className) {
    if (typeof cls === 'string') {
      if (TAG_NAME_CLASS_MAP[cls] && !baseWrapper) {
        baseWrapper = TAG_NAME_CLASS_MAP[cls];
      }
      if (cls === 'di-jsx') {
        hasDiJsx = true;
      }
    }
  }
  if (hasDiJsx) {
    return 'di-jt';
  }
  return baseWrapper;
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
 * - JSX component tags (pl-c1 with di-jsx) get `<span class="di-jt">` (JSX tag)
 *
 * Expects the pattern: text(`<`) + span(tagName) + text(`>`)
 * where `extendSyntaxTokens` has already normalized bracket spans to text nodes.
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
        // Scan forward past the tag name span to find the closing bracket text node.
        // It may be immediately after (simple tags like <div>) or separated by
        // attribute spans (e.g. <div className="x">).
        // Stop scanning if we hit a text node containing '<' (new tag context).
        let closingBracketIndex = -1;
        let closingBracket: { position: number; suffix: string } | null = null;

        for (let scanIdx = 1; scanIdx < queue.length; scanIdx += 1) {
          const scanNode = queue[scanIdx];
          if (scanNode.type === 'text') {
            const scanText = scanNode.value;
            closingBracket = findClosingBracket(scanText);
            if (closingBracket) {
              const matchEnd = closingBracket.position + closingBracket.suffix.length;
              if (closingBracket.position === 0 || matchEnd === scanText.length) {
                // > at the start or end of text is a tag-close token
                closingBracketIndex = scanIdx;
                break;
              }
              // The earliest > is in the middle of text — not a tag-close
              // token. Check for a > at the end of the text instead.
              closingBracket = null;
              if (scanText.endsWith(' />')) {
                closingBracket = { position: scanText.length - 3, suffix: ' />' };
              } else if (scanText.endsWith('/>')) {
                closingBracket = { position: scanText.length - 2, suffix: '/>' };
              } else if (scanText.endsWith('>')) {
                closingBracket = { position: scanText.length - 1, suffix: '>' };
              }
              if (closingBracket) {
                closingBracketIndex = scanIdx;
                break;
              }
            }
            // A '<' in text before any '>' means a new tag context — stop scanning
            if (scanText.includes('<')) {
              break;
            }
          }
        }

        if (closingBracket && closingBracketIndex !== -1) {
          // Add the text before the < (if any)
          const textBeforeBracket = textNode.value.slice(0, -prefix.length);
          if (textBeforeBracket) {
            newChildren.push({ type: 'text', value: textBeforeBracket });
          }

          // Build the wrapper children: bracket text + tag name span + intermediate nodes + closing text
          const closingTextNode = queue[closingBracketIndex] as Text;
          const contentBeforeClose = closingTextNode.value.slice(0, closingBracket.position);

          const wrapperChildren: ElementContent[] = [{ type: 'text', value: prefix }];

          // Add the tag name span and any intermediate nodes (attributes, etc.)
          for (let takeIdx = 0; takeIdx <= closingBracketIndex; takeIdx += 1) {
            if (takeIdx === closingBracketIndex) {
              // Last node is the text containing >; include content before + bracket
              wrapperChildren.push({
                type: 'text',
                value: contentBeforeClose + closingBracket.suffix,
              });
            } else {
              wrapperChildren.push(queue[takeIdx]);
            }
          }

          const wrapperSpan: Element = {
            type: 'element',
            tagName: 'span',
            properties: { className: [wrapperClass] },
            children: wrapperChildren,
          };
          newChildren.push(wrapperSpan);

          // Remove all consumed nodes from the queue
          const textAfterBracket = closingTextNode.value.slice(
            closingBracket.position + closingBracket.suffix.length,
          );
          queue.splice(0, closingBracketIndex + 1);

          // If there's remaining text after the closing bracket, re-insert it at the front of the queue
          // so it can be processed for the next pattern (e.g., consecutive tags)
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

    const text = getShallowTextContent(child);
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
 * Reclassifies `pl-smi` and `pl-k` spans whose text is a built-in type keyword
 * (e.g. `string`, `number`, `void`) to `pl-c1 di-bt`.
 *
 * Only applies to TypeScript-family languages, matching the contract in
 * `extendSyntaxTokens` which gates `di-bt` on `isTs`.
 *
 * Starry Night tokenizes standalone type keywords inconsistently when there is
 * no surrounding type context: most (`string`, `number`, …) become `pl-smi`
 * (identifier), while `void` becomes `pl-k` (keyword). In inline code this is
 * the common case — e.g. `` `string` `` — so we reclassify them to match the
 * output of `type x = string` (where starry-night produces `pl-c1`) and add
 * `di-bt` for semantic styling.
 *
 * For `pl-k` tokens (like `void`), we only reclassify when the token is the
 * sole child of the code element to avoid mis-highlighting the unary `void`
 * operator in expressions like `void fn()`.
 */
function enhanceBuiltInTypes(children: ElementContent[]): void {
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.type !== 'element' || child.tagName !== 'span') {
      continue;
    }

    const className = child.properties?.className;
    if (!Array.isArray(className)) {
      continue;
    }

    const smiIndex = className.indexOf('pl-smi');
    // Only reclassify pl-k when it is the only child (standalone keyword),
    // so the void *operator* in multi-token expressions is left alone.
    const kIndex = smiIndex === -1 && children.length === 1 ? className.indexOf('pl-k') : -1;
    const targetIndex = smiIndex !== -1 ? smiIndex : kIndex;
    if (targetIndex === -1) {
      continue;
    }

    const text = getShallowTextContent(child);
    if (text && BUILT_IN_TYPES.has(text)) {
      className[targetIndex] = 'pl-c1';
      className.push('di-bt');
    }
  }
}

/**
 * A rehype plugin that enhances inline code elements in three ways:
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
 * 3. **Built-in type enhancement** (TypeScript only): Reclassifies standalone
 *    type keywords (`string`, `number`, `void`, etc.) from `pl-smi`/`pl-k`
 *    to `pl-c1 di-bt`, matching `extendSyntaxTokens` output in type context.
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

      // Reclassify standalone built-in type keywords (TypeScript only)
      if (getLanguageCapabilities(node).supportsTypes) {
        enhanceBuiltInTypes(node.children);
      }
    });
  };
}
