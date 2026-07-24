import { aliasTarget, readPackageJson, writePackageJson } from './pnpm.mjs';

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
  // Already an alias: keeps a re-run after a partial failure a no-op.
  if (aliasTarget(spec)) {
    return null;
  }
  const range = spec.slice('workspace:'.length);
  return `workspace:${newName}@${range}`;
}

/**
 * Move the publishable workspace packages in one scope to another.
 *
 * Only packages that are part of the workspace are touched, so dependencies
 * that merely share the scope but come from the registry (say `@base-ui/react`
 * alongside a workspace `@base-ui/mosaic`) are left alone.
 *
 * @param {(import('./pnpm.mjs').PublicPackage | import('./pnpm.mjs').PrivatePackage)[]} packages - All workspace packages
 * @param {string} fromScope - Scope to move away from
 * @param {string} toScope - Scope to move to
 * @returns {Promise<Map<string, string>>} Old package name to new package name
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
    return renamed;
  }

  await Promise.all(
    packages.map(async (pkg) => {
      const packageJson = await readPackageJson(pkg.path);
      let changed = false;

      const newName = pkg.name ? renamed.get(pkg.name) : undefined;
      if (newName) {
        packageJson.name = newName;
        changed = true;
      }

      // peerDependencies are deliberately absent: a peer is supplied by the
      // consumer, who installs the package under its original name. An alias
      // range would be unsatisfiable for them.
      const dependencyGroups = [
        packageJson.dependencies,
        packageJson.devDependencies,
        packageJson.optionalDependencies,
      ];

      for (const deps of dependencyGroups) {
        if (!deps) {
          continue;
        }
        for (const [depName, spec] of Object.entries(deps)) {
          if (typeof spec !== 'string') {
            continue;
          }

          const existingTarget = aliasTarget(spec);
          if (existingTarget) {
            // An alias at a package being renamed would be left pointing at a
            // name that stops existing.
            if (renamed.has(existingTarget)) {
              throw new Error(
                `"${depName}" in ${pkg.name ?? pkg.path} already aliases ${existingTarget}, which is being renamed. Point it at the package directly so it can be rewritten.`,
              );
            }
            // Anything else is already aliased where it should be, which is what
            // a re-run after a partial failure looks like.
            continue;
          }

          const target = renamed.get(depName);
          if (!target) {
            continue;
          }
          const aliased = aliasWorkspaceSpec(spec, target);
          if (!aliased) {
            // Only `workspace:` specs can be aliased. Anything else would keep
            // resolving the original name from the registry after the rename.
            throw new Error(
              `"${depName}" in ${pkg.name ?? pkg.path} is required as "${spec}" rather than a workspace: dependency, so it cannot be pointed at ${target}.`,
            );
          }
          deps[depName] = aliased;
          changed = true;
        }
      }

      if (changed) {
        await writePackageJson(pkg.path, packageJson);
      }
    }),
  );

  return renamed;
}
