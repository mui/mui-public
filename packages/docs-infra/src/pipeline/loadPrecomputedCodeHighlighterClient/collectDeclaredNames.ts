/**
 * Collects identifier names that are already declared in the given source
 * (top-level imports, `const`/`let`/`var` bindings, function and class
 * declarations).
 *
 * The result is used to seed conflict-resolution when injecting additional
 * imports so that we never shadow an existing binding.
 *
 * This is intentionally a lightweight regex-based scan rather than a full
 * parser: we only need to gather identifier names well enough to avoid
 * collisions; over-collecting (e.g. matching a name inside a comment) is
 * harmless because it just causes the new import to be aliased.
 */
export function collectDeclaredNames(source: string): Set<string> {
  const names = new Set<string>();

  // Imports: default, namespace, and named (with optional `as` aliases).
  const importRegex =
    /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*(?:,\s*)?)?(?:\*\s+as\s+([A-Za-z_$][\w$]*))?(?:\{([^}]*)\})?\s*from\s*['"][^'"]+['"]/g;
  for (const match of source.matchAll(importRegex)) {
    const [, defaultName, namespaceName, namedBlock] = match;
    if (defaultName) {
      names.add(defaultName);
    }
    if (namespaceName) {
      names.add(namespaceName);
    }
    if (namedBlock) {
      for (const part of namedBlock.split(',')) {
        const trimmed = part.trim().replace(/^type\s+/, '');
        if (!trimmed) {
          continue;
        }
        const aliasMatch = trimmed.match(/\s+as\s+([A-Za-z_$][\w$]*)\s*$/);
        if (aliasMatch) {
          names.add(aliasMatch[1]);
        } else {
          const nameMatch = trimmed.match(/^([A-Za-z_$][\w$]*)/);
          if (nameMatch) {
            names.add(nameMatch[1]);
          }
        }
      }
    }
  }

  // Top-level `const`/`let`/`var` bindings (including destructuring, both
  // object and array). We capture the entire declaration body up to the
  // terminating `;` and harvest every identifier inside — over-collecting
  // (e.g. picking up a value identifier on the right-hand side) is harmless
  // because it only causes the new import to be aliased.
  const declarationRegex = /(?:^|[\n;{}])\s*(?:export\s+)?(?:const|let|var)\s+([^;]+);/g;
  for (const match of source.matchAll(declarationRegex)) {
    const binding = match[1];
    for (const idMatch of binding.matchAll(/[A-Za-z_$][\w$]*/g)) {
      names.add(idMatch[0]);
    }
  }

  // Top-level function and class declarations.
  const functionRegex =
    /(?:^|\n)\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(functionRegex)) {
    names.add(match[1]);
  }

  return names;
}
