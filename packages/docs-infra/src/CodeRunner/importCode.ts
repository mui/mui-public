import { evalCode } from './evalCode';
import { transformCode } from './transformCode';
import type { Scope } from './types';

/**
 * Transpiles and evaluates a module's source, returning its exports. Unlike the
 * element runner the source is not normalized, so it must declare its own
 * `export`s. Use this to register a file's exports under a specifier in a scope's
 * `import` registry, letting other sources `import` from it.
 */
export function importCode(code: string, scope?: Scope): Scope {
  const exports: Scope = {};
  evalCode(transformCode(code), { ...scope, exports });
  return exports;
}
