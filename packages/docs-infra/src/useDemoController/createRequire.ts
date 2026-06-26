/**
 * Builds the `require` shim handed to transpiled `import` statements. There is no
 * real module system at runtime, so specifiers are resolved by exact lookup in
 * the provided registry; anything missing throws.
 *
 * Lookup uses `Object.prototype.hasOwnProperty` so inherited members (e.g.
 * `toString`) are never mistaken for registered modules, and a registry created
 * with `Object.create(null)` still works.
 */
export function createRequire(modules: Record<string, unknown> = {}) {
  return (specifier: string): unknown => {
    if (!Object.prototype.hasOwnProperty.call(modules, specifier)) {
      throw new Error(`Module not found: '${specifier}'`);
    }
    return modules[specifier];
  };
}
