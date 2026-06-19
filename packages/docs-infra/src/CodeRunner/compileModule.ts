import * as React from 'react';
import { createRequire } from './createRequire';
import { transformCode } from './transformCode';
import type { Scope } from './types';

/**
 * Transpiles a module's source ONCE and returns a runner that evaluates it
 * against a `require` registry, writing into a caller-provided `exports`. Two
 * benefits of separating the compile from the run:
 *
 * - The costly, source-only work (sucrase transpile + `new Function` compile) can
 *   be cached per source file and the runner re-run cheaply as sibling modules
 *   change — without re-transpiling.
 * - The caller can register the `exports` object BEFORE running, so a circular
 *   import re-entering this module sees the in-progress exports instead of
 *   looping forever (CommonJS semantics).
 *
 * The runner injects `React` and a `require` shim backed by the passed `imports`,
 * mirroring the `{ import }` scope that {@link importCode} evaluates against.
 */
export function compileModule(
  code: string,
): (imports: Record<string, unknown>, exports: Scope) => void {
  const transpiled = transformCode(code);
  // `new Function` compiles the transpiled body once; the returned closure re-runs
  // it with the current registry, so changing one sibling doesn't re-transpile the
  // others. It can't close over the surrounding lexical scope.
  // eslint-disable-next-line no-new-func
  const evaluate = new Function('React', 'require', 'exports', transpiled);
  return (imports, exports) => {
    evaluate(React, createRequire(imports), exports);
  };
}
