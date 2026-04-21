import type { Root, Element, ElementContent, Text } from 'hast';
import { toText } from 'hast-util-to-text';
import { getShallowTextContent } from '../loadServerTypes/hastTypeUtils';
import { getLanguageCapabilitiesFromScope } from './languageCapabilities';

/**
 * Classes that can represent CSS attribute selector names inside `[...]`.
 * Current starry-night uses `pl-c1`, but a future fix may use `pl-e`.
 */
const CSS_ATTR_SELECTOR_CLASSES = new Set(['pl-c1', 'pl-e']);

/**
 * TypeScript built-in type keywords that starry-night classifies as `pl-c1`.
 * These are language primitives from the TypeScript specification.
 */
export const BUILT_IN_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'void',
  'never',
  'symbol',
  'object',
  'any',
  'unknown',
  'bigint',
]);

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
 * Replaces one CSS class with another in an element's className array.
 */
function replaceClass(element: Element, oldCls: string, newCls: string): void {
  const className = element.properties?.className;
  if (Array.isArray(className)) {
    const idx = className.indexOf(oldCls);
    if (idx !== -1) {
      className[idx] = newCls;
    }
  }
}

/**
 * Enhances `pl-c1` (constant) spans with more specific `di-*` classes
 * based on the text content.
 *
 * Language-agnostic:
 * - Numbers → `di-num`
 * - Booleans (`true`, `false`) → `di-bool`
 * - Nullish (`null`, `undefined`) → `di-n`
 *
 * JS/TS family only (`isJs`):
 * - `this`, `super` → `di-this`
 *
 * TS family only (`isTs`):
 * - Built-in type keywords (`string`, `number`, etc.) → `di-bt`
 */
function enhanceConstantSpan(element: Element, isJs: boolean, isTs: boolean): void {
  const text = getShallowTextContent(element);
  if (!text) {
    return;
  }

  if (text === 'true' || text === 'false') {
    addClass(element, 'di-bool');
  } else if (text === 'null' || text === 'undefined') {
    addClass(element, 'di-n');
  } else if (isNumericConstant(text)) {
    addClass(element, 'di-num');
  } else if (isJs && (text === 'this' || text === 'super')) {
    addClass(element, 'di-this');
  } else if (isTs && BUILT_IN_TYPES.has(text)) {
    addClass(element, 'di-bt');
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
  const fullText = toText(element, { whitespace: 'pre' });
  if (fullText === '""' || fullText === "''") {
    addClass(element, 'di-n');
  }
}

/**
 * Single-pass enhancement of a HAST children array. Processes each child exactly
 * once, applying all per-element and sibling-context enhancements in one iteration.
 * Recursively enhances nested elements.
 *
 * Per-element enhancements (applied to individual spans):
 * - `pl-c1` → `di-num`, `di-bool`, `di-n`, `di-this`, `di-bt` via enhanceConstantSpan
 * - `pl-s` → `di-n` for empty strings via enhanceStringSpan
 *
 * Sibling-context enhancements (depend on neighbor nodes or positional state):
 * - CSS `&` nesting selector → wraps in `pl-ent` span
 * - CSS `[attr]` → `di-da` on attribute name spans
 * - CSS `property: value` → `di-cp` / `di-cv` based on colon position
 * - HTML/JSX `<tag attr=value>` → `di-ak`, `di-ae`, `di-av`
 * - JSX `<Component>` → `di-jsx` on component name spans
 */
function enhanceChildren(
  children: ElementContent[],
  isCss: boolean,
  isHtmlJsx: boolean,
  isJs: boolean,
  isTs: boolean,
  isJsx: boolean,
): void {
  // CSS declaration state: tracks position relative to { } : ; [ ]
  let cssInsideBlock = false;
  let cssInsideBracket = false;
  let cssAfterColon = false;

  // HTML/JSX tag state: whether we're between < and >
  let htmlInsideTag = false;

  // Whether a span appeared between the last text node and the current position.
  // Used to detect attribute context for = wrapping (replaces backward scanning).
  let hasSpanSinceLastText = false;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];

    // ── Text nodes: state tracking and structural splits ──
    if (child.type === 'text') {
      const savedSpanFlag = hasSpanSinceLastText;
      hasSpanSinceLastText = false;
      const { value } = child;

      // CSS: track { } [ ] : ; state and wrap & nesting selectors
      if (isCss) {
        const ampIndex = value.indexOf('&');
        const trackEnd = ampIndex !== -1 ? ampIndex : value.length;

        for (let ci = 0; ci < trackEnd; ci += 1) {
          const char = value[ci];
          if (char === '{') {
            cssInsideBlock = true;
            cssAfterColon = false;
          } else if (char === '}') {
            cssInsideBlock = false;
            cssAfterColon = false;
          } else if (char === '[') {
            cssInsideBracket = true;
          } else if (char === ']') {
            cssInsideBracket = false;
          } else if (char === ':' && cssInsideBlock && !cssInsideBracket) {
            cssAfterColon = true;
          } else if (char === ';') {
            cssAfterColon = false;
          }
        }

        // Wrap bare & in a pl-ent span to match GitHub rendering of CSS nesting selector
        if (ampIndex !== -1) {
          const before = value.slice(0, ampIndex);
          const after = value.slice(ampIndex + 1);

          const ampSpan: Element = {
            type: 'element',
            tagName: 'span',
            properties: { className: ['pl-ent'] },
            children: [{ type: 'text', value: '&' }],
          };

          const newNodes: ElementContent[] = [];
          if (before) {
            newNodes.push({ type: 'text', value: before } as Text);
          }
          newNodes.push(ampSpan);
          if (after) {
            newNodes.push({ type: 'text', value: after } as Text);
          }

          children.splice(index, 1, ...newNodes);
          // Advance past the inserted span to process remaining text for more & chars
          index += newNodes.indexOf(ampSpan);
          continue;
        }
      }

      // HTML/JSX: track < > tag boundaries and wrap bare = in attribute context
      if (isHtmlJsx) {
        for (let ci = 0; ci < value.length; ci += 1) {
          if (value[ci] === '<') {
            htmlInsideTag = true;
          } else if (value[ci] === '>') {
            htmlInsideTag = false;
          }
        }

        if (htmlInsideTag && savedSpanFlag) {
          const equalsIndex = value.indexOf('=');
          if (equalsIndex !== -1) {
            // Tag the following pl-s span as attribute value
            const nextChild = children[index + 1];
            if (
              nextChild &&
              nextChild.type === 'element' &&
              nextChild.tagName === 'span' &&
              getFirstClass(nextChild) === 'pl-s'
            ) {
              addClass(nextChild, 'di-av');
            }

            // Split text around = and wrap in di-ae span
            const before = value.slice(0, equalsIndex);
            const after = value.slice(equalsIndex + 1);

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

            children.splice(index, 1, ...newNodes);
            index += newNodes.length - 1;
            hasSpanSinceLastText = newNodes[newNodes.length - 1].type === 'element';
          }
        }
      }

      continue;
    }

    // ── Non-element nodes: skip ──
    if (child.type !== 'element') {
      continue;
    }

    // Recurse into nested elements (frames, lines, nested spans)
    if (child.children.length > 0) {
      enhanceChildren(child.children, isCss, isHtmlJsx, isJs, isTs, isJsx);
    }

    if (child.tagName !== 'span') {
      continue;
    }

    const hadPrecedingSpan = hasSpanSinceLastText;
    hasSpanSinceLastText = true;
    const firstClass = getFirstClass(child);

    // ── Per-element enhancements (all grammars) ──
    if (firstClass === 'pl-c1') {
      enhanceConstantSpan(child, isJs, isTs);
    } else if (firstClass === 'pl-s') {
      enhanceStringSpan(child);
    }

    // ── CSS-specific enhancements ──
    if (isCss) {
      // CSS attribute selector name: span preceded by text ending with [
      if (firstClass && CSS_ATTR_SELECTOR_CLASSES.has(firstClass) && index > 0) {
        const prev = children[index - 1];
        if (prev.type === 'text' && prev.value.endsWith('[')) {
          addClass(child, 'di-da');
        }
      }

      // CSS property name / value classification based on : position
      if (firstClass === 'pl-c1' && cssInsideBlock && !cssInsideBracket) {
        addClass(child, cssAfterColon ? 'di-cv' : 'di-cp');
      }
    }

    // ── HTML/JSX attribute enhancements ──
    if (isHtmlJsx && htmlInsideTag) {
      // Attribute key: pl-e inside a tag
      if (firstClass === 'pl-e') {
        addClass(child, 'di-ak');
      }

      // Attribute equals: pl-k span containing =
      if (firstClass === 'pl-k' && getShallowTextContent(child) === '=' && hadPrecedingSpan) {
        addClass(child, 'di-ae');
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
    }

    // ── JSX component name detection ──
    if (isJsx && index > 0) {
      const prev = children[index - 1];

      // Opening/closing: text ending in < or </ followed by pl-c1
      if (firstClass === 'pl-c1' && prev.type === 'text') {
        if (prev.value.endsWith('<') || prev.value.endsWith('</')) {
          addClass(child, 'di-jsx');
        }
      }

      // Standalone closing: pl-k("</") followed by pl-smi or pl-c1
      // Normalize the token shape to match the text-bracket pattern:
      // - pl-smi JSX component (PascalCase) → pl-c1 + di-jsx
      // - pl-smi HTML element (lowercase) → pl-ent
      // - Remove pl-k from the adjacent bracket spans
      if (
        (firstClass === 'pl-smi' || firstClass === 'pl-c1') &&
        prev.type === 'element' &&
        prev.tagName === 'span' &&
        getFirstClass(prev) === 'pl-k' &&
        getShallowTextContent(prev) === '</'
      ) {
        // Find the closing bracket span: pl-k(">")
        const closeBracket = children[index + 1];
        const hasCloseBracket =
          closeBracket &&
          closeBracket.type === 'element' &&
          closeBracket.tagName === 'span' &&
          getFirstClass(closeBracket) === 'pl-k' &&
          getShallowTextContent(closeBracket) === '>';

        if (firstClass === 'pl-c1') {
          addClass(child, 'di-jsx');
        } else {
          const tagText = getShallowTextContent(child);
          const isComponent =
            tagText &&
            tagText[0] === tagText[0].toUpperCase() &&
            tagText[0] !== tagText[0].toLowerCase();

          if (isComponent) {
            // JSX component: pl-smi → pl-c1 + di-jsx
            replaceClass(child, 'pl-smi', 'pl-c1');
            addClass(child, 'di-jsx');
          } else {
            // HTML element: pl-smi → pl-ent
            replaceClass(child, 'pl-smi', 'pl-ent');
          }
        }

        // Replace bracket spans with text nodes to match the text-bracket pattern.
        // This allows enhanceCodeInline to handle both patterns uniformly.
        const prevText = getShallowTextContent(prev) ?? '</';
        children[index - 1] = { type: 'text', value: prevText } as Text;
        if (hasCloseBracket) {
          const closeText = getShallowTextContent(closeBracket as Element) ?? '>';
          children[index + 1] = { type: 'text', value: closeText } as Text;
        }
      }
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
  const caps = getLanguageCapabilitiesFromScope(grammarScope);
  const isCss = caps.semantics === 'css';
  const isHtmlJsx = caps.supportsJsx || grammarScope === 'text.html.basic';
  const isJs = caps.semantics === 'js';
  const isTs = caps.supportsTypes;
  const isJsx = caps.supportsJsx;

  enhanceChildren(tree.children as ElementContent[], isCss, isHtmlJsx, isJs, isTs, isJsx);
}
