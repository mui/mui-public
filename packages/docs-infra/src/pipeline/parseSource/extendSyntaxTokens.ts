import type { Root, Element, ElementContent, Text } from 'hast';
import { HTML_JSX_GRAMMARS, CSS_GRAMMARS } from './grammars';

/**
 * Classes that can represent CSS attribute selector names inside `[...]`.
 * Current starry-night uses `pl-c1`, but a future fix may use `pl-e`.
 */
const CSS_ATTR_SELECTOR_CLASSES = new Set(['pl-c1', 'pl-e']);

/**
 * Checks whether a `pl-c1` token's text represents a numeric value.
 *
 * Since starry-night already classified the token as a constant (`pl-c1`),
 * we only need to distinguish numbers from named constants like `Button` or `color`.
 * A simple first-character check is sufficient: numbers start with a digit,
 * optional `-` sign, or `.` followed by a digit.
 *
 * Matches: `42`, `3.14`, `-1`, `.5`, `0xFF`, `100px`, `50%`, `3em`
 * Does not match: `color`, `red`, `Button`, `NaN`, `Infinity`
 */
function isNumericConstant(text: string): boolean {
  if (text.length === 0) {
    return false;
  }

  const start = text[0] === '-' ? 1 : 0;
  if (start >= text.length) {
    return false;
  }

  const charCode = text.charCodeAt(start);

  // Starts with a digit (0-9)
  if (charCode >= 48 && charCode <= 57) {
    return true;
  }

  // Starts with '.' followed by a digit
  if (charCode === 46 && start + 1 < text.length) {
    const nextCharCode = text.charCodeAt(start + 1);
    return nextCharCode >= 48 && nextCharCode <= 57;
  }

  return false;
}

/**
 * Gets the text content of an element's first direct text child.
 */
function getDirectTextContent(element: Element): string | undefined {
  const firstChild = element.children[0];
  if (firstChild && firstChild.type === 'text') {
    return firstChild.value;
  }
  return undefined;
}

/**
 * Recursively extracts all text content from a HAST node tree.
 */
function getFullTextContent(node: ElementContent): string {
  if (node.type === 'text') {
    return node.value;
  }
  if (node.type === 'element') {
    return node.children.map(getFullTextContent).join('');
  }
  return '';
}

/**
 * Gets the first CSS class from an element's className array.
 */
function getFirstClass(element: Element): string | undefined {
  const className = element.properties?.className;
  if (Array.isArray(className) && typeof className[0] === 'string') {
    return className[0];
  }
  return undefined;
}

/**
 * Adds a CSS class to an element's className array (additive, never removes existing classes).
 */
function addClass(element: Element, cls: string): void {
  if (!element.properties) {
    element.properties = {};
  }
  if (Array.isArray(element.properties.className)) {
    element.properties.className.push(cls);
  } else {
    element.properties.className = [cls];
  }
}

/**
 * Enhances `pl-c1` (constant) spans with more specific `di-*` classes
 * based on the text content. This is language-agnostic.
 *
 * - Numbers → `di-num`
 * - Booleans (`true`, `false`) → `di-bool`
 * - Nullish (`null`, `undefined`) → `di-n`
 */
function enhanceConstantSpan(element: Element): void {
  const text = getDirectTextContent(element);
  if (!text) {
    return;
  }

  if (text === 'true' || text === 'false') {
    addClass(element, 'di-bool');
  } else if (text === 'null' || text === 'undefined') {
    addClass(element, 'di-n');
  } else if (isNumericConstant(text)) {
    addClass(element, 'di-num');
  }
}

/**
 * Enhances `pl-s` (string) spans for empty string literals (`""`, `''`)
 * by adding the `di-n` (nullish) class.
 *
 * Starry-night may tokenize `""` as:
 * `<span class="pl-s"><span class="pl-pds">"</span><span class="pl-pds">"</span></span>`
 * so we need to extract the full recursive text content and check.
 */
function enhanceStringSpan(element: Element): void {
  const fullText = element.children.map(getFullTextContent).join('');
  if (fullText === '""' || fullText === "''") {
    addClass(element, 'di-n');
  }
}

/**
 * Enhances CSS attribute selector names (e.g., `data-starting-style` in `[data-starting-style]`)
 * by adding `di-da` to spans that are preceded by a `[` bracket.
 *
 * Current starry-night uses `pl-c1` for these names; a future fix may use `pl-e`.
 * Both are handled.
 */
function enhanceCssAttributeSelectors(children: ElementContent[]): void {
  for (let index = 1; index < children.length; index += 1) {
    const child = children[index];
    if (child.type !== 'element' || child.tagName !== 'span') {
      continue;
    }

    const firstClass = getFirstClass(child);
    if (!firstClass || !CSS_ATTR_SELECTOR_CLASSES.has(firstClass)) {
      continue;
    }

    // Check if the previous sibling is a text node ending with `[`
    const previous = children[index - 1];
    if (previous.type === 'text' && previous.value.endsWith('[')) {
      addClass(child, 'di-da');
    }
  }
}

/**
 * Enhances HTML/JSX attribute equals signs and attribute values.
 *
 * Walks the children array tracking whether we're inside an open tag (`<...>`).
 * When inside a tag:
 * - Plain text `=` between a span and a `pl-s` string span → wrap `=` in `<span class="di-ae">`
 * - The `pl-s` span after it → add `di-av`
 *
 * Mutates the children array in place (may insert new nodes when splitting text).
 */
function enhanceHtmlAttributes(children: ElementContent[]): void {
  let insideTag = false;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];

    // Track tag context via text nodes containing < and >
    if (child.type === 'text') {
      const value = child.value;
      // Scan through the text for < and > to update tag state.
      // Process characters to handle cases like `<div onClick=> text` in one text node.
      for (let charIndex = 0; charIndex < value.length; charIndex += 1) {
        const char = value[charIndex];
        if (char === '<') {
          insideTag = true;
        } else if (char === '>') {
          insideTag = false;
        }
      }
    }

    if (!insideTag) {
      continue;
    }

    // Look for the pattern: text containing `=` followed by a `pl-s` span
    if (child.type !== 'text') {
      continue;
    }

    const equalsIndex = child.value.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    // Check that the next sibling is a pl-s span (attribute value)
    const nextChild = children[index + 1];
    if (
      !nextChild ||
      nextChild.type !== 'element' ||
      nextChild.tagName !== 'span' ||
      getFirstClass(nextChild) !== 'pl-s'
    ) {
      continue;
    }

    // Check that there's a previous span sibling (attribute name)
    let hasPreviousSpan = false;
    for (let prevIndex = index - 1; prevIndex >= 0; prevIndex -= 1) {
      const prev = children[prevIndex];
      if (prev.type === 'element' && prev.tagName === 'span') {
        hasPreviousSpan = true;
        break;
      }
      if (prev.type === 'text') {
        break;
      }
    }

    if (!hasPreviousSpan) {
      continue;
    }

    // Add di-av to the attribute value span
    addClass(nextChild, 'di-av');

    // Split text node and wrap `=` in a span
    const before = child.value.slice(0, equalsIndex);
    const after = child.value.slice(equalsIndex + 1);

    const equalsSpan: Element = {
      type: 'element',
      tagName: 'span',
      properties: { className: ['di-ae'] },
      children: [{ type: 'text', value: '=' }],
    };

    const newNodes: ElementContent[] = [];
    if (before) {
      newNodes.push({ type: 'text', value: before } as Text);
    }
    newNodes.push(equalsSpan);
    if (after) {
      newNodes.push({ type: 'text', value: after } as Text);
    }

    // Replace the text node with the split nodes
    children.splice(index, 1, ...newNodes);

    // Advance index past the inserted nodes (skip the equals span and any 'after' text)
    index += newNodes.length - 1;
  }
}

/**
 * Recursively walks HAST tree children, applying language-agnostic `di-*` extensions
 * to individual span elements and collecting children arrays for sibling-context
 * extensions.
 */
function walkAndEnhance(
  children: ElementContent[],
  grammarScope: string,
  childrenArrays: ElementContent[][],
): void {
  childrenArrays.push(children);

  for (const child of children) {
    if (child.type !== 'element') {
      continue;
    }

    // Apply per-element enhancements
    if (child.tagName === 'span') {
      const firstClass = getFirstClass(child);
      if (firstClass === 'pl-c1') {
        enhanceConstantSpan(child);
      } else if (firstClass === 'pl-s') {
        enhanceStringSpan(child);
      }
    }

    // Recurse into children (frames, lines, nested spans)
    if (child.children.length > 0) {
      walkAndEnhance(child.children, grammarScope, childrenArrays);
    }
  }
}

/**
 * Extends a syntax-highlighted HAST tree with additional `di-*` CSS classes
 * for fine-grained styling control. All extensions are **additive** — existing
 * `pl-*` classes from starry-night are never removed.
 *
 * @param tree - The HAST root node produced by starry-night's `highlight()`
 * @param grammarScope - The grammar scope used for highlighting (e.g., 'source.tsx', 'source.css')
 */
export function extendSyntaxTokens(tree: Root, grammarScope: string): void {
  // Collect all children arrays during the walk for sibling-context passes
  const childrenArrays: ElementContent[][] = [];

  // First pass: walk the tree, enhance individual elements, collect children arrays
  walkAndEnhance(tree.children as ElementContent[], grammarScope, childrenArrays);

  // Second pass: sibling-context enhancements on each collected children array
  const isCss = CSS_GRAMMARS.has(grammarScope);
  const isHtmlJsx = HTML_JSX_GRAMMARS.has(grammarScope);

  for (const childrenArray of childrenArrays) {
    if (isCss) {
      enhanceCssAttributeSelectors(childrenArray);
    }
    if (isHtmlJsx) {
      enhanceHtmlAttributes(childrenArray);
    }
  }
}
