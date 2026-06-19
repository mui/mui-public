import * as React from 'react';
import { evalCode } from './evalCode';
import { normalizeCode, transformCode } from './transformCode';
import type { RunnerOptions, Scope } from './types';

/**
 * Registry key (deliberately not a valid import specifier, so no demo source can
 * import it) under which the scope may hold the exports object the entry should
 * populate. When `buildScope` registers the main source so an extra can import the
 * entry, it points this — and the entry's `./index` keys — at one object, so the
 * rendered entry and the importing extra share a SINGLE evaluation.
 */
export const ENTRY_EXPORTS_KEY = '\0entry-exports';

/**
 * Transpiles and evaluates a source string, returning the React node it exports
 * as its default. A source can expose that default three ways: an explicit
 * `export default`, a call to the injected `render(value)` callback, or a bare
 * leading expression promoted to a default export (see `normalizeCode`).
 *
 * The resolved default is coerced to something renderable — an element is
 * returned as-is, a component type is instantiated with no props, and a string is
 * returned verbatim. An empty source or a falsy/non-renderable default yields
 * `null`.
 */
export function generateElement({ code, scope }: RunnerOptions): React.ReactNode {
  if (!code.trim()) {
    return null;
  }

  // Evaluate into the shared registry object when present (see ENTRY_EXPORTS_KEY),
  // so this entry and any extra that imports it see the same exports; otherwise a
  // fresh object.
  const shared = scope?.import?.[ENTRY_EXPORTS_KEY];
  const exports: Scope = shared && typeof shared === 'object' ? (shared as Scope) : {};
  const render = (value: unknown): void => {
    exports.default = value;
  };

  evalCode(transformCode(normalizeCode(code)), { render, ...scope, exports });

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
