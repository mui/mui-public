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
 * Enhances CSS `pl-c1` spans with `di-cp` (property name) or `di-cv` (property value)
 * based on position relative to `:` inside declaration blocks.
 *
 * Tracks `{` / `}` to know when we're inside a declaration block.
 * Only classifies tokens that appear inside `{...}`:
 * - `pl-c1` before `:` → add `di-cp` (CSS property name like `transition`, `color`)
 * - `pl-c1` after `:` → add `di-cv` (CSS property value like `red`, `flex`, `var`)
 * - State resets at `;` and `}`.
 *
 * Tokens outside declaration blocks (selectors, at-rule parameters) are left untouched.
 */
function enhanceCssPropertyValues(children: ElementContent[]): void {
  let insideBlock = false;
  let afterColon = false;

  for (const child of children) {
    // Track block boundaries and colon/semicolon in text nodes
    if (child.type === 'text') {
      const value = child.value;
      for (let charIndex = 0; charIndex < value.length; charIndex += 1) {
        const char = value[charIndex];
        if (char === '{') {
          insideBlock = true;
          afterColon = false;
        } else if (char === '}') {
          insideBlock = false;
          afterColon = false;
        } else if (char === ':') {
          if (insideBlock) {
            afterColon = true;
          }
        } else if (char === ';') {
          afterColon = false;
        }
      }
      continue;
    }

    if (child.type !== 'element' || child.tagName !== 'span') {
      continue;
    }

    const firstClass = getFirstClass(child);
    if (firstClass === 'pl-c1' && insideBlock) {
      addClass(child, afterColon ? 'di-cv' : 'di-cp');
    }
  }
}

/**
 * Enhances HTML/JSX attribute names, equals signs, and attribute values.
 *
 * Walks the children array tracking whether we're inside an open tag (`<...>`).
 * When inside a tag:
 * - `pl-e` spans → add `di-ak` (attribute key/name)
 * - Plain text `=` between a span and a `pl-s` string span → wrap `=` in `<span class="di-ae">`
 * - `pl-k` span containing `=` → add `di-ae`
 * - The `pl-s` span after `=` → add `di-av`
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

    // Attribute key: `pl-e` span inside a tag → add `di-ak`
    if (child.type === 'element' && child.tagName === 'span' && getFirstClass(child) === 'pl-e') {
      addClass(child, 'di-ak');
    }

    // Pattern 1: `=` inside a `pl-k` span (e.g., starry-night TSX output: <span class="pl-k">=</span>)
    if (
      child.type === 'element' &&
      child.tagName === 'span' &&
      getFirstClass(child) === 'pl-k' &&
      getDirectTextContent(child) === '='
    ) {
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

      if (hasPreviousSpan) {
        addClass(child, 'di-ae');
        // Only tag the value when it's a string literal (pl-s)
        const nextChild = children[index + 1];
        if (
          nextChild &&
          nextChild.type === 'element' &&
          nextChild.tagName === 'span' &&
          getFirstClass(nextChild) === 'pl-s'
        ) {
          addClass(nextChild, 'di-av');
        }
      }
      continue;
    }

    // Pattern 2: `=` as bare text (e.g., `className=` in a text node)
    if (child.type !== 'text') {
      continue;
    }

    const equalsIndex = child.value.indexOf('=');
    if (equalsIndex === -1) {
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

    // Only tag the value when it's a string literal (pl-s)
    const nextChild = children[index + 1];
    if (
      nextChild &&
      nextChild.type === 'element' &&
      nextChild.tagName === 'span' &&
      getFirstClass(nextChild) === 'pl-s'
    ) {
      addClass(nextChild, 'di-av');
    }

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
 * Recursively walks HAST tree children, applying `di-*` extensions:
 * per-element enhancements (di-num, di-bool, di-n, di-p, di-cvar) and
 * sibling-context enhancements (di-da, di-cp, di-cv, di-ak, di-ae, di-av).
 */
function walkAndEnhance(
  children: ElementContent[],
  grammarScope: string,
  isCss: boolean,
  isHtmlJsx: boolean,
): void {
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
      } else if (firstClass === 'pl-v') {
        if (isCss) {
          addClass(child, 'di-cvar');
        }
      } else if (firstClass === 'pl-smi') {
        if (!isCss) {
          addClass(child, 'di-p');
        }
      }
    }

    // Recurse into children (frames, lines, nested spans)
    if (child.children.length > 0) {
      walkAndEnhance(child.children, grammarScope, isCss, isHtmlJsx);
    }
  }

  // Sibling-context enhancements on this children array
  if (isCss) {
    enhanceCssAttributeSelectors(children);
    enhanceCssPropertyValues(children);
  }
  if (isHtmlJsx) {
    enhanceHtmlAttributes(children);
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
  const isCss = CSS_GRAMMARS.has(grammarScope);
  const isHtmlJsx = HTML_JSX_GRAMMARS.has(grammarScope);

  walkAndEnhance(tree.children as ElementContent[], grammarScope, isCss, isHtmlJsx);
}
