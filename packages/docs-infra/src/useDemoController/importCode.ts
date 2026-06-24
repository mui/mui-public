import { compileModule } from './compileModule';
import type { Scope } from './types';

/**
 * Transpiles and evaluates a module's source, returning its exports. Unlike the
 * element runner the source is not normalized, so it must declare its own
 * `export`s. Use this to register a file's exports under a specifier in a scope's
 * `import` registry, letting other sources `import` from it.
 *
 * A one-shot wrapper over {@link compileModule}; callers that re-evaluate the same
 * source as siblings change should cache the `compileModule` runner instead.
 */
export function importCode(code: string, scope?: Scope): Scope {
  const exports: Scope = {};
  compileModule(code)(scope?.import ?? {}, exports);
  return exports;
}
