import type { Root, Element, ElementContent, Text } from 'hast';
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
 * Starry-night tokenizes an empty string as exactly two `pl-pds` quote-delimiter
 * spans with no content between them:
 * `<span class="pl-s"><span class="pl-pds">"</span><span class="pl-pds">"</span></span>`
 * so we can detect it structurally without recursively serializing the text.
 */
function enhanceStringSpan(element: Element): void {
  const { children } = element;
  if (children.length !== 2) {
    return;
  }
  const [open, close] = children;
  if (
    open.type === 'element' &&
    getFirstClass(open) === 'pl-pds' &&
    close.type === 'element' &&
    getFirstClass(close) === 'pl-pds'
  ) {
    addClass(element, 'di-n');
  }
}

/**
 * Tests whether a `pl-k` token's text consists entirely of symbol characters
 * (no letters, digits, or underscore). Used to distinguish symbolic operators
 * (`=`, `=>`, `&&`, `...`) from word keywords (`const`, `if`, `function`).
 */
function isSymbolicPunctuation(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    // 0-9
    if (code >= 48 && code <= 57) {
      return false;
    }
    // A-Z
    if (code >= 65 && code <= 90) {
      return false;
    }
    // a-z
    if (code >= 97 && code <= 122) {
      return false;
    }
    // _
    if (code === 95) {
      return false;
    }
  }
  return true;
}

/**
 * Splits a text value into nodes, wrapping bare identifier object-literal keys
 * (e.g. `height` in `{ height: 400 }`) in a `<span>` carrying `di-op` plus, when
 * `inJsx` is true, also `di-jv`. Returns `null` if no key pattern is found,
 * leaving the original text node untouched.
 *
 * A key is detected as `[A-Za-z_$][\w$]*` immediately preceded by `{` or `,`
 * (with optional whitespace) and followed by optional whitespace, then a single
 * `:` not part of `::`. The leading-context check avoids tagging ternary/label
 * patterns; the trailing check avoids `::` (TypeScript namespace, pseudo-elements).
 */
function splitObjectKeys(value: string, inJsx: boolean): ElementContent[] | null {
  const nodes: ElementContent[] = [];
  let lastEnd = 0;
  let i = 0;
  while (i < value.length) {
    const code = value.charCodeAt(i);
    const isIdentStart =
      (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36;
    if (!isIdentStart) {
      i += 1;
      continue;
    }

    // Find preceding non-whitespace character; must be `{` or `,` (object key context)
    let prev = i - 1;
    while (prev >= 0) {
      const pc = value.charCodeAt(prev);
      if (pc !== 32 && pc !== 9 && pc !== 10 && pc !== 13) {
        break;
      }
      prev -= 1;
    }
    if (prev < 0) {
      i += 1;
      continue;
    }
    const prevCode = value.charCodeAt(prev);
    if (prevCode !== 123 /* { */ && prevCode !== 44 /* , */) {
      i += 1;
      continue;
    }

    // Consume identifier chars
    let end = i + 1;
    while (end < value.length) {
      const ec = value.charCodeAt(end);
      const isIdentPart =
        (ec >= 48 && ec <= 57) ||
        (ec >= 65 && ec <= 90) ||
        (ec >= 97 && ec <= 122) ||
        ec === 95 ||
        ec === 36;
      if (!isIdentPart) {
        break;
      }
      end += 1;
    }

    // Skip whitespace, expect a single `:` (not `::`)
    let after = end;
    while (after < value.length) {
      const ac = value.charCodeAt(after);
      if (ac !== 32 && ac !== 9 && ac !== 10 && ac !== 13) {
        break;
      }
      after += 1;
    }
    if (after >= value.length || value.charCodeAt(after) !== 58 /* : */) {
      i = end;
      continue;
    }
    if (after + 1 < value.length && value.charCodeAt(after + 1) === 58) {
      i = end;
      continue;
    }

    if (i > lastEnd) {
      nodes.push({ type: 'text', value: value.slice(lastEnd, i) } as Text);
    }
    const className = inJsx ? ['di-op', 'di-jv'] : ['di-op'];
    nodes.push({
      type: 'element',
      tagName: 'span',
      properties: { className },
      children: [{ type: 'text', value: value.slice(i, end) }],
    });
    lastEnd = end;
    i = end;
  }

  if (nodes.length === 0) {
    return null;
  }
  if (lastEnd < value.length) {
    nodes.push({ type: 'text', value: value.slice(lastEnd) } as Text);
  }
  return nodes;
}

/**
 * Tests whether a string starts with optional whitespace followed by `:`.
 * Used to detect that a `pl-s` span sits in object property-key position.
 */
function startsWithColon(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    if (ch === 58) {
      return true;
    }
    // space, tab, newline, carriage return
    if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) {
      return false;
    }
  }
  return false;
}

/**
 * Frame in the template-literal interpolation stack. A `string` frame means we
 * are inside template-string content; an `expr` frame means we are inside a
 * `${ ... }` interpolation expression, tracking `{`/`}` nesting via `braceDepth`
 * so the matching close brace can be found across object literals and lines.
 */
type TemplateFrame = { mode: 'string' } | { mode: 'expr'; braceDepth: number };

/** Creates an empty `di-te` interpolation-region span. */
function createInterpolationRegion(): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['di-te'] },
    children: [],
  };
}

/** Creates a `di-td` delimiter span wrapping the given `${` or `}` glyph. */
function createInterpolationDelimiter(value: string): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['di-td'] },
    children: [{ type: 'text', value }],
  };
}

/** True when a node is a `pl-pds` span whose text is a backtick. */
function isBacktickDelimiter(node: ElementContent | undefined): boolean {
  return (
    !!node &&
    node.type === 'element' &&
    node.tagName === 'span' &&
    getFirstClass(node) === 'pl-pds' &&
    getShallowTextContent(node) === '`'
  );
}

function pushText(target: ElementContent[], value: string): void {
  target.push({ type: 'text', value } as Text);
}

/**
 * Scans one text node of a template literal, splitting it around interpolation
 * boundaries. In `string` mode it looks for `${` (opening a `di-te` region with a
 * `di-td` delimiter); in `expr` mode it counts `{`/`}` to find the matching close
 * (emitting the closing `di-td`). Mutates `stack` and `targets` in place as it
 * crosses boundaries, appending nodes to the innermost current target.
 */
function processTemplateText(
  value: string,
  stack: TemplateFrame[],
  targets: ElementContent[][],
): void {
  let i = 0;
  let segStart = 0;
  while (i < value.length) {
    const top = stack[stack.length - 1];
    const target = targets[targets.length - 1];
    if (top.mode === 'string') {
      const open = value.indexOf('${', i);
      if (open === -1) {
        break;
      }
      if (open > segStart) {
        pushText(target, value.slice(segStart, open));
      }
      const region = createInterpolationRegion();
      target.push(region);
      region.children.push(createInterpolationDelimiter('${'));
      stack.push({ mode: 'expr', braceDepth: 1 });
      targets.push(region.children);
      i = open + 2;
      segStart = i;
    } else {
      const code = value.charCodeAt(i);
      if (code === 123 /* { */) {
        top.braceDepth += 1;
        i += 1;
      } else if (code === 125 /* } */) {
        top.braceDepth -= 1;
        if (top.braceDepth === 0) {
          if (i > segStart) {
            pushText(target, value.slice(segStart, i));
          }
          target.push(createInterpolationDelimiter('}'));
          stack.pop();
          targets.pop();
          i += 1;
          segStart = i;
        } else {
          i += 1;
        }
      } else {
        i += 1;
      }
    }
  }
  if (segStart < value.length) {
    pushText(targets[targets.length - 1], value.slice(segStart));
  }
}

/**
 * Restructures one `pl-s` template-literal line, wrapping each `${ ... }`
 * interpolation slice on the line in a `di-te` region with `di-td` delimiters.
 *
 * `entryStack` carries the interpolation state from previous lines (a single
 * `string` frame for the opening line). `isOpener` is true for the line that
 * holds the opening backtick. Because starry-night emits one `pl-s` span per line
 * and the line gutter splits on top-level newlines, a region can never cross a
 * line boundary — each line's slice is wrapped on its own, so a continuation
 * line opens a fresh `di-te` with no leading `${`. Returns the stack to carry to
 * the next line, or `null` once the closing backtick is consumed (run complete).
 */
function restructureTemplateLine(
  pls: Element,
  entryStack: TemplateFrame[],
  isOpener: boolean,
): TemplateFrame[] | null {
  const source = pls.children;
  const out: ElementContent[] = [];
  const stack: TemplateFrame[] = entryStack.map((frame) => ({ ...frame }));

  // Rebuild the physical target chain for the carried stack: each open `expr`
  // frame gets a fresh `di-te` region on this line; nested `string` frames share
  // their parent expression's region as the target.
  const targets: ElementContent[][] = [out];
  for (let depth = 1; depth < stack.length; depth += 1) {
    if (stack[depth].mode === 'expr') {
      const region = createInterpolationRegion();
      targets[depth - 1].push(region);
      targets.push(region.children);
    } else {
      targets.push(targets[depth - 1]);
    }
  }

  let runEnded = false;
  let index = 0;
  if (isOpener) {
    out.push(source[0]);
    index = 1;
  }

  for (; index < source.length; index += 1) {
    const node = source[index];
    const target = targets[targets.length - 1];

    if (node.type === 'text') {
      processTemplateText(node.value, stack, targets);
      continue;
    }

    if (isBacktickDelimiter(node)) {
      if (stack[stack.length - 1].mode === 'expr') {
        // A nested template literal opens inside the interpolation expression.
        target.push(node);
        stack.push({ mode: 'string' });
        targets.push(target);
      } else if (stack.length === 1) {
        // The outer template's closing backtick — the run is complete.
        out.push(node);
        runEnded = true;
      } else {
        // A nested template literal's closing backtick.
        target.push(node);
        stack.pop();
        targets.pop();
      }
      continue;
    }

    target.push(node);
  }

  pls.children = out;
  return runEnded ? null : stack;
}

/**
 * Single-pass enhancement of a HAST children array. Processes each child exactly
 * once, applying all per-element and sibling-context enhancements in one iteration.
 * Recursively enhances nested elements.
 *
 * Per-element enhancements (applied to individual spans):
 * - `pl-c1` → `di-num`, `di-bool`, `di-n`, `di-this`, `di-bt` via enhanceConstantSpan
 * - `pl-s` → `di-n` for empty strings via enhanceStringSpan
 * - `pl-k` symbolic operators (`=`, `=>`, `&&`, `...`) → `di-pu`
 *
 * Sibling-context enhancements (depend on neighbor nodes or positional state):
 * - CSS `&` nesting selector → wraps in `pl-ent` span
 * - CSS `[attr]` → `di-da` on attribute name spans
 * - CSS `property: value` → `di-cp` / `di-cv` based on colon position
 * - HTML/JSX `<tag attr=value>` → `di-ak`, `di-ae`, `di-av`
 * - JSX `<Component>` → `di-jsx` on component name spans
 * - JSX `{expression}` → `di-jv` on `pl-smi`/`pl-v` identifier spans inside braces
 * - JS `'key':` object property string → `di-ps` on `pl-s` spans
 * - JS template literals → `di-te` region / `di-td` delimiters around `${ ... }`
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

  // JSX expression depth: how many `pl-pse` `{` braces are currently open.
  // Identifiers (`pl-smi`, `pl-v`) inside an expression are tagged as JSX variables.
  let jsxExpressionDepth = 0;

  // Whether a span appeared between the last text node and the current position.
  // Used to detect attribute context for = wrapping (replaces backward scanning).
  let hasSpanSinceLastText = false;

  // Template-literal interpolation state, carried across the per-line `pl-s` spans
  // of one multi-line literal. `null` when not inside a template-literal run.
  let templateRun: TemplateFrame[] | null = null;

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

      // HTML/JSX: track < > tag boundaries and wrap bare = in attribute context.
      // A trailing `<` (next sibling = element) only enters tag mode when the next
      // element looks like a JSX tag — `pl-ent` (HTML element) or `pl-c1` whose text
      // isn't a TS built-in primitive. This avoids treating TS generics like
      // `useState<number | null>` or `<T = string>` as JSX tags.
      if (isHtmlJsx) {
        for (let ci = 0; ci < value.length; ci += 1) {
          if (value[ci] === '<') {
            if (ci === value.length - 1) {
              const nextChild = children[index + 1];
              if (
                isJsx &&
                nextChild &&
                nextChild.type === 'element' &&
                nextChild.tagName === 'span'
              ) {
                const nextClass = getFirstClass(nextChild);
                if (nextClass === 'pl-ent') {
                  htmlInsideTag = true;
                } else if (nextClass === 'pl-c1') {
                  const nextText = getShallowTextContent(nextChild);
                  if (nextText && !BUILT_IN_TYPES.has(nextText)) {
                    htmlInsideTag = true;
                  }
                }
              } else {
                htmlInsideTag = true;
              }
            } else {
              htmlInsideTag = true;
            }
          } else if (value[ci] === '>') {
            htmlInsideTag = false;
          }
        }
      }

      // Bare object-literal keys (e.g. `height` in `{ height: 400 }`) become di-op spans.
      // Inside a JSX attribute expression they also receive di-jv. Done before the `=` split
      // below, which only fires in attribute context (htmlInsideTag) — the two paths don't conflict.
      // Children expressions (e.g. `<Comp>{children}</Comp>`) are excluded by the htmlInsideTag check.
      if (isJs) {
        const split = splitObjectKeys(value, isJsx && jsxExpressionDepth > 0 && htmlInsideTag);
        if (split) {
          children.splice(index, 1, ...split);
          index += split.length - 1;
          hasSpanSinceLastText = split[split.length - 1].type === 'element';
          continue;
        }
      }

      if (isHtmlJsx && htmlInsideTag && savedSpanFlag) {
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

      continue;
    }

    // ── Non-element nodes: skip ──
    if (child.type !== 'element') {
      continue;
    }

    // ── Template-literal interpolation (JS family) ──
    // starry-night tokenizes a backtick string as a `pl-s` span (one per line for
    // multi-line literals). Wrap each `${ ... }` slice in a `di-te` region with
    // `di-td` delimiters so the interpolated expression resets from the string
    // color. `templateRun` carries the brace/nesting state across the per-line
    // `pl-s` spans; a run starts on the line whose first child is the opening
    // backtick. Handled here, before the generic recursion, so the expression
    // tokens are enhanced inside their regions and the outer `pl-s` is skipped.
    if (isJs && child.tagName === 'span' && getFirstClass(child) === 'pl-s') {
      const opensRun = templateRun === null && isBacktickDelimiter(child.children[0]);
      if (templateRun !== null || opensRun) {
        templateRun = restructureTemplateLine(child, templateRun ?? [{ mode: 'string' }], opensRun);
        // Empty backtick literals (`` `` ``) keep their nullish (`di-n`) classification.
        enhanceStringSpan(child);
        // Enhance the interpolated expressions (e.g. `di-num` on `${42}`) within
        // each region; nested regions are reached by the recursion.
        for (const region of child.children) {
          if (region.type === 'element' && getFirstClass(region) === 'di-te') {
            enhanceChildren(region.children, isCss, isHtmlJsx, isJs, isTs, isJsx);
          }
        }
        hasSpanSinceLastText = true;
        continue;
      }
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
    } else if (firstClass === 'pl-k') {
      const text = getShallowTextContent(child);
      if (text && isSymbolicPunctuation(text)) {
        addClass(child, 'di-pu');
      }
    }

    // ── JSX expression brace tracking ──
    if (isJsx && firstClass === 'pl-pse') {
      const text = getShallowTextContent(child);
      if (text === '{') {
        jsxExpressionDepth += 1;
      } else if (text === '}' && jsxExpressionDepth > 0) {
        jsxExpressionDepth -= 1;
      }
    }

    // ── JSX variable: identifier-like spans inside an attribute expression ──
    // - `pl-smi` plain identifier (e.g. `row` in `{row.name}`)
    // - `pl-v` parameter / variable (e.g. arrow function params)
    // - `pl-c1` after a `.` text node — member-access property (e.g. `name` in `{row.name}`).
    //   Skips numbers/booleans/nullish (which `enhanceConstantSpan` has already classified)
    //   and JSX components (handled below by the `<`/`</` detection).
    //
    // Restricted to attribute context (`htmlInsideTag`) so children expressions like
    // `<Comp>{children}</Comp>` are not tagged.
    if (isJsx && jsxExpressionDepth > 0 && htmlInsideTag) {
      if (firstClass === 'pl-smi' || firstClass === 'pl-v') {
        addClass(child, 'di-jv');
      } else if (firstClass === 'pl-c1' && index > 0) {
        const prev = children[index - 1];
        if (prev.type === 'text' && prev.value.endsWith('.')) {
          addClass(child, 'di-jv');
        }
      }
    }

    // ── JS object property string: pl-s followed by text starting with `:` ──
    // String keys (e.g. `'aria-label': value`) get the dedicated `di-op` class plus
    // `di-ps` for the string-shape detail. Inside JSX expressions, also add `di-jv`
    // so themes that style JSX variables can include string keys.
    if (isJs && firstClass === 'pl-s') {
      const next = children[index + 1];
      if (next && next.type === 'text' && startsWithColon(next.value)) {
        addClass(child, 'di-op');
        addClass(child, 'di-ps');
        if (isJsx && jsxExpressionDepth > 0 && htmlInsideTag) {
          addClass(child, 'di-jv');
        }
      }
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

      // Opening/closing: text ending in < or </ followed by pl-c1.
      // Skip TS built-in types (e.g. `number` in `useState<number>`) so generic
      // type arguments aren't mistaken for JSX components.
      if (firstClass === 'pl-c1' && prev.type === 'text') {
        if (prev.value.endsWith('<') || prev.value.endsWith('</')) {
          const text = getShallowTextContent(child);
          if (!text || !BUILT_IN_TYPES.has(text)) {
            addClass(child, 'di-jsx');
          }
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
