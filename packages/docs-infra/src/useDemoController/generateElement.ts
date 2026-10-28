import type * as React from 'react';
import { instantiateElement, ENTRY_EXPORTS_KEY } from './instantiateElement';
import { normalizeCode, transformCode } from './transformCode';
import type { RunnerOptions } from './types';

export { ENTRY_EXPORTS_KEY };

/**
 * Transpiles and evaluates a source string, returning the React node it exports
 * as its default. A synchronous convenience that pairs the two halves —
 * `normalizeCode` + `transformCode` (the heavy sucrase transpile) and
 * {@link instantiateElement} (`evalCode` + node coercion) — for callers that
 * transpile on the main thread. The async/worker path splits them: it transpiles
 * off-thread and calls `instantiateElement` directly with the result.
 *
 * A source can expose its default three ways: an explicit `export default`, a
 * call to the injected `render(value)` callback, or a bare leading expression
 * promoted to a default export (see `normalizeCode`). An empty source yields
 * `null`.
 */
export function generateElement({ code, scope }: RunnerOptions): React.ReactNode {
  if (!code.trim()) {
    return null;
  }
  return instantiateElement(transformCode(normalizeCode(code)), scope);
}
