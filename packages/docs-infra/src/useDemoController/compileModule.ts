import { instantiateModule } from './instantiateModule';
import { transformCode } from './transformCode';
import type { ModuleRun } from './types';

/**
 * Transpiles a module's source and returns a runner that evaluates it against a
 * `require` registry, writing into a caller-provided `exports`. A synchronous
 * convenience that pairs the two halves — `transformCode` (the heavy sucrase
 * transpile) and {@link instantiateModule} (`new Function` + run) — for callers
 * that transpile on the main thread. The async/worker path splits them: it
 * transpiles off-thread and calls `instantiateModule` directly with the result.
 *
 * The returned runner injects `React` and a `require` shim backed by the passed
 * `imports`, mirroring the `{ import }` scope that {@link importCode} evaluates
 * against.
 */
export function compileModule(code: string): ModuleRun {
  return instantiateModule(transformCode(code));
}
