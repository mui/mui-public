import * as React from 'react';
import { createRequire } from './createRequire';
import type { ModuleRun } from './types';

/**
 * Compiles ALREADY-TRANSPILED CommonJS-style module code into a runner that
 * evaluates it against a `require` registry, writing into a caller-provided
 * `exports`. This is the main-thread half of loading a module: `new Function`
 * (and the eval it produces) cannot run in a Web Worker, so it stays here — while
 * the heavy `transformCode` transpile that produces `transpiled` can run
 * off-thread.
 *
 * `new Function` compiles the transpiled body once; the returned closure re-runs
 * it with the current registry, so changing one sibling doesn't re-transpile the
 * others. It can't close over the surrounding lexical scope. The caller registers
 * the `exports` object BEFORE running, so a circular import re-entering this
 * module sees the in-progress exports instead of looping forever (CommonJS
 * semantics).
 */
export function instantiateModule(transpiled: string): ModuleRun {
  // eslint-disable-next-line no-new-func
  const evaluate = new Function('React', 'require', 'exports', transpiled);
  return (imports, exports) => {
    evaluate(React, createRequire(imports), exports);
  };
}
