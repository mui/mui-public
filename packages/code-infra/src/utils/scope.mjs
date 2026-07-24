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
 * Move the publishable workspace packages in one scope to another.
 *
 * Only packages that are part of the workspace are touched, so dependencies
 * that merely share the scope but come from the registry (say `@base-ui/react`
 * alongside a workspace `@base-ui/mosaic`) are left alone. Dependents keep the
 * original dependency name and gain a `workspace:` alias, so imports in the
 * repo resolve exactly as before.
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
    if (pkg.isPrivate) {
      continue;
    }
    const newName = renameScope(pkg.name, fromScope, toScope);
    if (newName) {
      renamed.set(pkg.name, newName);
    }
  }

  // Rewrite in memory first. A dependency that cannot be pointed at its renamed
  // package has to fail before anything is written, or the workspace is left
  // half renamed with nothing to restore it.
  const rewritten = await Promise.all(
    packages.map(async (pkg) => {
      const packageJson = await readPackageJson(pkg.path);
      const label = pkg.name ?? pkg.path;
      /** @type {string[]} */
      const problems = [];
      let changed = false;

      const newName = pkg.name ? renamed.get(pkg.name) : undefined;
      if (newName) {
        packageJson.name = newName;
        changed = true;
      }

      // peerDependencies are deliberately absent: a peer is supplied by the
      // consumer, who installs the package under its original name. An alias
      // range would be unsatisfiable for them.
      for (const deps of [
        packageJson.dependencies,
        packageJson.devDependencies,
        packageJson.optionalDependencies,
      ]) {
        for (const [depName, spec] of Object.entries(deps ?? {})) {
          if (!spec) {
            continue;
          }

          const existingTarget = aliasTarget(spec);
          if (existingTarget) {
            if (renamed.has(existingTarget)) {
              problems.push(
                `"${depName}" in ${label} already aliases ${existingTarget}, which is being renamed. Point it at the package directly so it can be rewritten.`,
              );
            }
            // Otherwise it already aliases what it should, as a re-run does.
            continue;
          }

          const target = renamed.get(depName);
          if (!target) {
            continue;
          }
          if (!spec.startsWith('workspace:')) {
            // Only `workspace:` specs can be aliased. Anything else would keep
            // resolving the original name from the registry after the rename.
            problems.push(
              `"${depName}" in ${label} is required as "${spec}" rather than a workspace: dependency, so it cannot be pointed at ${target}.`,
            );
            continue;
          }
          deps[depName] = `workspace:${target}@${spec.slice('workspace:'.length)}`;
          changed = true;
        }
      }

      return { path: pkg.path, packageJson, changed, problems };
    }),
  );

  const problems = rewritten.flatMap((entry) => entry.problems);
  if (problems.length > 0) {
    throw new Error(`Cannot rename ${fromScope} to ${toScope}:\n  ${problems.join('\n  ')}`);
  }

  await Promise.all(
    rewritten
      .filter((entry) => entry.changed)
      .map((entry) => writePackageJson(entry.path, entry.packageJson)),
  );

  return renamed;
}
