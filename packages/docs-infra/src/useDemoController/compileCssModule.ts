import { hashString } from './hashString';

export interface CssModuleOptions {
  /**
   * Seed for the generated class-name hash. Defaults to the source itself, so
   * identical sources hash identically — keeping scoped names stable across
   * server render, client hydration, and live-edit recompiles.
   */
  hashSeed?: string;
}

export interface CompiledCssModule {
  /** The transformed CSS, with every local class selector scoped. */
  css: string;
  /**
   * Map of original local class name to its scoped name — the module's exports.
   * Register it in a runner scope's `import` map so demo code can resolve
   * `import styles from './styles.module.css'` to `styles.button` etc.
   */
  exports: Record<string, string>;
}

/**
 * At-rules whose body is a list of rules (so class selectors nested directly
 * inside are still scoped). Other at-rules (`@keyframes`, `@font-face`, …) hold
 * declarations or non-class selectors and are left alone.
 */
const NESTED_RULE_AT_RULES = new Set(['media', 'supports', 'container', 'layer']);

/** CSS identifier start char: letter, `_`, `-`, or non-ASCII. */
function isNameStart(code: number): boolean {
  return (
    (code >= 97 && code <= 122) || // a-z
    (code >= 65 && code <= 90) || // A-Z
    code === 95 || // _
    code === 45 || // -
    code >= 128
  );
}

/** CSS identifier continuation char: a name-start char or a digit. */
function isNameChar(code: number): boolean {
  return isNameStart(code) || (code >= 48 && code <= 57); // 0-9
}

function isWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

/**
 * Compiles a CSS Modules source string into scoped CSS plus its class-name
 * exports, using a single-pass, regex-free scanner.
 *
 * Each local class selector `.button` becomes `.button-<hash>` in the CSS and
 * `{ button: 'button-<hash>' }` in {@link CompiledCssModule.exports}. Class names
 * are only rewritten in selector context (the top level or inside an at-rule
 * group such as `@media`); declaration values — where `.5em`, `#fff`, and
 * `url(./x.png)` live — are never touched. Comment and string contents are
 * preserved verbatim.
 *
 * Supported subset: flat rules, compound/combinator/pseudo selectors, and
 * at-rule groups. Not handled (left unchanged): nesting of style rules
 * (`.a { .b {} }`), `:global()`, `composes`, and `@keyframes`/animation-name
 * scoping (names pass through, so animations still work but are not isolated).
 */
export function compileCssModule(
  source: string,
  options: CssModuleOptions = {},
): CompiledCssModule {
  const suffix = hashString(options.hashSeed ?? source).padStart(5, '0');
  const exports: Record<string, string> = {};

  const scopeClass = (local: string): string => {
    let scoped = exports[local];
    if (scoped === undefined) {
      scoped = `${local}-${suffix}`;
      exports[local] = scoped;
    }
    return scoped;
  };

  const { length } = source;
  let out = '';

  // Whether class selectors are scoped at the current depth. True at the top
  // level and inside at-rule group bodies; false inside declaration blocks
  // (so value tokens are never mistaken for classes). Parent values are stacked.
  let scoping = true;
  const scopeStack: boolean[] = [];

  // The leading `@`-keyword of the current prelude (text since the last
  // `{`/`}`/`;`), used to classify the block opened by the next `{`.
  let preludeAtRule: string | null = null;
  let preludeStarted = false;

  let index = 0;
  while (index < length) {
    const char = source[index];

    // Comment — copy through untouched.
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? length : end + 2;
      out += source.slice(index, stop);
      index = stop;
      continue;
    }

    // String literal — copy through untouched, honoring backslash escapes.
    if (char === '"' || char === "'") {
      preludeStarted = true;
      let cursor = index + 1;
      while (cursor < length) {
        if (source[cursor] === '\\') {
          cursor += 2;
        } else if (source[cursor] === char) {
          cursor += 1;
          break;
        } else {
          cursor += 1;
        }
      }
      out += source.slice(index, cursor);
      index = cursor;
      continue;
    }

    // Block open — classify it from the prelude, then descend.
    if (char === '{') {
      const isGroup = preludeAtRule !== null && NESTED_RULE_AT_RULES.has(preludeAtRule);
      scopeStack.push(scoping);
      // Group bodies inherit the parent's selector context; everything else
      // (style rules, `@keyframes`, …) is a non-scoping declaration block.
      scoping = isGroup ? scoping : false;
      preludeAtRule = null;
      preludeStarted = false;
      out += char;
      index += 1;
      continue;
    }

    // Block close / statement end — reset the prelude.
    if (char === '}') {
      const parent = scopeStack.pop();
      scoping = parent ?? true;
      preludeAtRule = null;
      preludeStarted = false;
      out += char;
      index += 1;
      continue;
    }
    if (char === ';') {
      preludeAtRule = null;
      preludeStarted = false;
      out += char;
      index += 1;
      continue;
    }

    // Class selector — scope it (only in selector context).
    if (char === '.' && scoping && isNameStart(source.charCodeAt(index + 1))) {
      preludeStarted = true;
      let cursor = index + 1;
      while (cursor < length && isNameChar(source.charCodeAt(cursor))) {
        cursor += 1;
      }
      out += `.${scopeClass(source.slice(index + 1, cursor))}`;
      index = cursor;
      continue;
    }

    // First significant char of a prelude: capture the at-rule keyword.
    if (!preludeStarted && !isWhitespace(source.charCodeAt(index))) {
      preludeStarted = true;
      if (char === '@') {
        let cursor = index + 1;
        while (cursor < length && isNameChar(source.charCodeAt(cursor))) {
          cursor += 1;
        }
        preludeAtRule = source.slice(index + 1, cursor).toLowerCase();
        out += source.slice(index, cursor);
        index = cursor;
        continue;
      }
    }

    out += char;
    index += 1;
  }

  return { css: out, exports };
}
