import { transform as sucraseTransform } from 'sucrase';

/**
 * Sucrase prefixes its output with a `"use strict";` prologue. The evaluated body
 * already runs in strict mode inside the generated function, so the prologue is
 * stripped to keep the result minimal.
 */
const USE_STRICT_PROLOGUE = '"use strict";';

/**
 * Transpiles a TypeScript/JSX source string into plain JavaScript that uses
 * CommonJS-style `require`/`exports`, ready to run with `evalCode`.
 *
 * JSX is emitted with the classic runtime (`React.createElement`), so `React`
 * must be in scope when the result is evaluated.
 */
export function transformCode(code: string): string {
  const { code: transpiled } = sucraseTransform(code, {
    transforms: ['jsx', 'typescript', 'imports'],
    production: true,
  });

  return transpiled.startsWith(USE_STRICT_PROLOGUE)
    ? transpiled.slice(USE_STRICT_PROLOGUE.length)
    : transpiled;
}

/**
 * Matches a source that leads (after optional whitespace) with a renderable
 * expression: a JSX element, a function declaration/expression, a zero-argument
 * arrow function, or a class. Only the first line is captured so the rest of the
 * source is preserved untouched.
 */
const LEADING_RENDERABLE = /^(\s*)(<[^>]*>|function[\s(]|\(\)\s*=>|class\s)(.*)/;

/**
 * Promotes a bare leading expression to the module's default export, so a snippet
 * like `<App />` can be run on its own. Sources that already declare their own
 * exports — or lead with anything else — are returned unchanged.
 */
export function normalizeCode(code: string): string {
  return code.replace(LEADING_RENDERABLE, '$1export default $2$3');
}
