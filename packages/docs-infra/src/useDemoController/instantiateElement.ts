import * as React from 'react';
import { evalCode } from './evalCode';
import type { Scope } from './types';

/**
 * Registry key (deliberately not a valid import specifier, so no demo source can
 * import it) under which the scope may hold the exports object the entry should
 * populate. When `buildScope` registers the main source so an extra can import the
 * entry, it points this — and the entry's `./index` keys — at one object, so the
 * rendered entry and the importing extra share a SINGLE evaluation.
 */
export const ENTRY_EXPORTS_KEY = '\0entry-exports';

/**
 * Evaluates ALREADY-TRANSPILED entry code and returns the React node it exports
 * as its default. This is the main-thread half of rendering the entry: the
 * `evalCode`/`new Function` here cannot run in a Web Worker, while the
 * `transformCode`/`normalizeCode` that produce `transpiled` can run off-thread.
 *
 * A source can expose its default three ways: an explicit `export default`, a
 * call to the injected `render(value)` callback, or a bare leading expression
 * promoted to a default export by `normalizeCode` (applied before transpiling).
 * The resolved default is coerced to something renderable — an element is
 * returned as-is, a component type is instantiated with no props, and a string is
 * returned verbatim. A falsy/non-renderable default (or empty code) yields `null`.
 */
export function instantiateElement(transpiled: string, scope?: Scope): React.ReactNode {
  // Evaluate into the shared registry object when present (see ENTRY_EXPORTS_KEY),
  // so this entry and any extra that imports it see the same exports; otherwise a
  // fresh object.
  const shared = scope?.import?.[ENTRY_EXPORTS_KEY];
  const exports: Scope = shared && typeof shared === 'object' ? (shared as Scope) : {};
  const render = (value: unknown): void => {
    exports.default = value;
  };

  evalCode(transpiled, { render, ...scope, exports });

  const exported = exports.default;
  if (!exported) {
    return null;
  }
  if (React.isValidElement(exported)) {
    return exported;
  }
  if (typeof exported === 'function') {
    // Verified as a function above; treat it as a component and render it.
    return React.createElement(exported as React.ComponentType);
  }
  if (typeof exported === 'string') {
    return exported;
  }
  return null;
}
