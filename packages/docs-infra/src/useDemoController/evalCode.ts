import * as React from 'react';
import { createRequire } from './createRequire';
import type { Scope } from './types';

/**
 * Evaluates already-transpiled CommonJS-style code with `scope` bound as local
 * variables. `React` and a `require` shim (backed by `scope.import`) are always
 * injected. The `import` key is consumed by the shim rather than bound, and
 * `default` is skipped because it is a reserved word and cannot name a function
 * parameter.
 *
 * Returns the evaluated function's return value; callers that need a module's
 * exports pass an `exports` object in `scope` and read it back after the call.
 */
export function evalCode(code: string, scope: Scope): unknown {
  const boundScope: Record<string, unknown> = {
    React,
    require: createRequire(scope.import),
  };

  for (const key of Object.keys(scope)) {
    if (key !== 'import' && key !== 'default') {
      boundScope[key] = scope[key];
    }
  }

  const names = Object.keys(boundScope);
  const values = names.map((name) => boundScope[name]);

  // Evaluating transpiled demo source is the whole purpose of the runner;
  // `new Function` runs it without leaking the surrounding lexical scope.
  // eslint-disable-next-line no-new-func
  const evaluate = new Function(...names, code);
  return evaluate(...values);
}
