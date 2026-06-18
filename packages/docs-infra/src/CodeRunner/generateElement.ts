import * as React from 'react';
import { evalCode } from './evalCode';
import { normalizeCode, transformCode } from './transformCode';
import type { RunnerOptions, Scope } from './types';

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

  const exports: Scope = {};
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
