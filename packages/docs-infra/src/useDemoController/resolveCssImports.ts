/** A compiled CSS-module's single-file form, awaiting cross-file resolution. */
export interface CssModuleToResolve {
  /** The registry key this module is exported under (used verbatim in the output). */
  key: string;
  /** The module's path within the demo (e.g. `dir/theme.module.css`) — drives `from` resolution. */
  fileName: string;
  /** Single-file exports; a `composes ... from` value still holds opaque placeholder tokens. */
  exports: Record<string, string>;
  /** `{ './other.module.css': { '<placeholder>': 'importedName' } }` from `compileCssModule`. */
  imports: Record<string, Record<string, string>>;
}

/**
 * Resolves a relative CSS `composes ... from` path against the importing file,
 * using plain `/` segment math (no `path` module, so it runs in the browser).
 * Returns a normalized file name to look the sibling up by.
 */
function resolveRelativePath(fromFileName: string, importPath: string): string {
  const lastSlash = fromFileName.lastIndexOf('/');
  const segments = lastSlash === -1 ? [] : fromFileName.slice(0, lastSlash).split('/');
  for (const segment of importPath.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment !== '..') {
      segments.push(segment);
    } else if (segments.length > 0 && segments[segments.length - 1] !== '..') {
      // Step up into a real parent directory.
      segments.pop();
    } else {
      // Already at (or above) the base — keep the `..` so a path that legitimately
      // points above the importing file's directory (e.g. a root-level module that
      // composes from `../shared/x`) survives instead of being silently flattened.
      segments.push('..');
    }
  }
  return segments.join('/');
}

/** Replaces placeholder tokens in a space-separated class value, dropping empties. */
function applyReplacements(value: string, replacements: Record<string, string>): string {
  return value
    .split(' ')
    .map((token) => (token in replacements ? replacements[token] : token))
    .filter(Boolean)
    .join(' ');
}

/**
 * Resolves cross-file `composes ... from` references across a set of compiled
 * CSS modules, returning each module's final exports keyed by registry key.
 *
 * Each module's single-file exports may carry opaque placeholder tokens standing
 * in for a class composed from a sibling (see {@link CssModuleToResolve.imports}).
 * This swaps every token for the sibling's resolved scoped name — recursively, so
 * a chain (`a` composes from `b` composes from `c`) flattens fully, with a stack
 * guard breaking any composition cycle. A placeholder whose sibling or name is
 * missing is dropped (the rest of the value survives).
 *
 * This runs on every assembly rather than being cached per file: a module's
 * resolved value depends on its SIBLINGS' exports, which change when a sibling is
 * edited even though this module's own source — and its cache entry — did not.
 */
export function resolveCssImports(
  modules: CssModuleToResolve[],
): Map<string, Record<string, string>> {
  const byFileName = new Map(modules.map((module) => [module.fileName, module]));
  const resolvedByKey = new Map<string, Record<string, string>>();

  const resolve = (module: CssModuleToResolve, ancestors: Set<string>): Record<string, string> => {
    const cached = resolvedByKey.get(module.key);
    if (cached) {
      return cached;
    }

    // Build the token → resolved-value map from this module's cross-file imports.
    const replacements: Record<string, string> = {};
    for (const [importPath, tokens] of Object.entries(module.imports)) {
      const target = byFileName.get(resolveRelativePath(module.fileName, importPath));
      const targetExports =
        target && !ancestors.has(target.key)
          ? resolve(target, new Set(ancestors).add(module.key))
          : {};
      for (const [token, name] of Object.entries(tokens)) {
        replacements[token] = targetExports[name] ?? '';
      }
    }

    const resolvedExports: Record<string, string> = {};
    for (const [local, value] of Object.entries(module.exports)) {
      resolvedExports[local] = applyReplacements(value, replacements);
    }
    resolvedByKey.set(module.key, resolvedExports);
    return resolvedExports;
  };

  for (const module of modules) {
    resolve(module, new Set());
  }
  return resolvedByKey;
}
