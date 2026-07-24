import { readPackageJson, writePackageJson } from './pnpm.mjs';

/**
 * Map a package name onto a different npm scope.
 * @param {string} name - Package name, e.g. `@base-ui/mosaic`
 * @param {string} fromScope - Scope to replace, e.g. `@base-ui`
 * @param {string} toScope - Replacement scope, e.g. `@base-ui-private`
 * @returns {string | null} The renamed package, or null when the scope doesn't match
 */
export function renameScope(name, fromScope, toScope) {
  const prefix = `${fromScope}/`;
  return name.startsWith(prefix) ? `${toScope}/${name.slice(prefix.length)}` : null;
}

/**
 * Point a `workspace:` dependency at a renamed package without changing the
 * dependency's own name, using pnpm's alias syntax
 * (`workspace:<name>@<range>`). Consumers keep importing the original name
 * because that is still what lands in node_modules.
 *
 * @param {string} spec - Existing dependency spec
 * @param {string} newName - Name the dependency now resolves to
 * @returns {string | null} Rewritten spec, or null when it needs no change
 */
export function aliasWorkspaceSpec(spec, newName) {
  if (!spec.startsWith('workspace:')) {
    return null;
  }
  const range = spec.slice('workspace:'.length);
  // Already an alias (`workspace:@scope/name@range`) — leave it alone.
  if (range.includes('@', 1)) {
    return null;
  }
  return `workspace:${newName}@${range}`;
}

/**
 * @typedef {Object} ScopeRenameResult
 * @property {Map<string, string>} renamed - Old package name to new package name
 * @property {string[]} updatedDependents - Paths whose dependency specs were rewritten
 */

/**
 * Move the publishable workspace packages in one scope to another.
 *
 * Only packages that are part of the workspace are touched, so dependencies
 * that merely share the scope but come from the registry (say `@base-ui/react`
 * alongside a workspace `@base-ui/mosaic`) are left alone.
 *
 * Dependents keep the original dependency name and gain an alias spec, so no
 * import in the repo has to change.
 *
 * @param {(import('./pnpm.mjs').PublicPackage | import('./pnpm.mjs').PrivatePackage)[]} packages - All workspace packages
 * @param {string} fromScope - Scope to move away from
 * @param {string} toScope - Scope to move to
 * @returns {Promise<ScopeRenameResult>}
 */
export async function renameWorkspaceScope(packages, fromScope, toScope) {
  /** @type {Map<string, string>} */
  const renamed = new Map();

  for (const pkg of packages) {
    if (pkg.isPrivate || !pkg.name) {
      continue;
    }
    const newName = renameScope(pkg.name, fromScope, toScope);
    if (newName) {
      renamed.set(pkg.name, newName);
    }
  }

  if (renamed.size === 0) {
    return { renamed, updatedDependents: [] };
  }

  /** @type {string[]} */
  const updatedDependents = [];

  await Promise.all(
    packages.map(async (pkg) => {
      const packageJson = await readPackageJson(pkg.path);
      let changed = false;

      const newName = pkg.name ? renamed.get(pkg.name) : undefined;
      if (newName) {
        packageJson.name = newName;
        changed = true;
      }

      const dependencyGroups = [
        packageJson.dependencies,
        packageJson.devDependencies,
        packageJson.peerDependencies,
        packageJson.optionalDependencies,
      ];

      for (const deps of dependencyGroups) {
        if (!deps) {
          continue;
        }
        for (const [depName, spec] of Object.entries(deps)) {
          const target = renamed.get(depName);
          if (!target || typeof spec !== 'string') {
            continue;
          }
          const aliased = aliasWorkspaceSpec(spec, target);
          if (aliased) {
            deps[depName] = aliased;
            changed = true;
            if (!updatedDependents.includes(pkg.path)) {
              updatedDependents.push(pkg.path);
            }
          }
        }
      }

      if (changed) {
        await writePackageJson(pkg.path, packageJson);
      }
    }),
  );

  return { renamed, updatedDependents };
}
