#!/usr/bin/env node

import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { $ } from 'execa';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as semver from 'semver';

/**
 * @typedef {Object} PrivatePackage
 * @property {string} [name] - Package name
 * @property {string} [version] - Package version
 * @property {string} path - Package directory path
 * @property {true} isPrivate - Whether the package is private
 */

/**
 * @typedef {Object} PublicPackage
 * @property {string} name - Package name
 * @property {string} version - Package version
 * @property {string} path - Package directory path
 * @property {false} isPrivate - Whether the package is private
 */

/**
 * @typedef {Object} VersionInfo
 * @property {boolean} currentVersionExists - Whether current version exists on npm
 * @property {string|null} latestCanaryVersion - Latest canary version if available
 */

/**
 * @typedef {Object} PublishOptions
 * @property {boolean} [dryRun] - Whether to run in dry-run mode
 * @property {boolean} [noGitChecks] - Whether to skip git checks
 * @property {string} [tag] - NPM dist tag to publish to
 */

/**
 * @typedef {Object} PnpmListResultItem
 * @property {string} [name] - Package name
 * @property {string} [version] - Package version
 * @property {string} path - Package directory path
 * @property {boolean} private - Whether the package is private
 */

/**
 * @typedef {Object} GetWorkspacePackagesOptions
 * @property {string|null} [sinceRef] - Git reference to filter changes since
 * @property {boolean} [publicOnly=false] - Whether to filter to only public packages
 * @property {boolean} [nonPublishedOnly=false] - Whether to filter to only non-published packages. It by default means public packages yet to be published.
 * @property {string} [cwd] - Current working directory to run pnpm command in
 * @property {string[]} [filter] - Same as filtering packages with --filter in pnpm. Only include packages matching the filter. See https://pnpm.io/filtering.
 */

/**
 * Get workspace packages with optional filtering
 *
 * @overload
 * @param {{ publicOnly: true } & GetWorkspacePackagesOptions} [options={}] - Options for filtering packages
 * @returns {Promise<PublicPackage[]>} Array of packages
 *
 * @overload
 * @param {{ nonPublishedOnly: true } & GetWorkspacePackagesOptions} [options={}] - Options for filtering packages
 * @returns {Promise<PublicPackage[]>} Array of packages
 *
 * @overload
 * @param {{ publicOnly?: false | undefined } & GetWorkspacePackagesOptions} [options={}] - Options for filtering packages
 * @returns {Promise<PrivatePackage[]>} Array of packages
 *
 * @overload
 * @param {GetWorkspacePackagesOptions} [options={}] - Options for filtering packages
 * @returns {Promise<(PrivatePackage | PublicPackage)[]>} Array of packages
 *
 * @param {GetWorkspacePackagesOptions} [options={}] - Options for filtering packages
 * @returns {Promise<(PrivatePackage | PublicPackage)[]>} Array of packages
 */
export async function getWorkspacePackages(options = {}) {
  const { sinceRef = null, publicOnly = false, nonPublishedOnly = false, filter = [] } = options;

  // Build command with conditional filter
  const filterArg = sinceRef ? ['--filter', `...[${sinceRef}]`] : [];
  if (filter.length > 0) {
    filter.forEach((f) => {
      filterArg.push('--filter', f);
    });
  }
  const result = options.cwd
    ? await $({ cwd: options.cwd })`pnpm ls -r --json --depth -1 ${filterArg}`
    : await $`pnpm ls -r --json --depth -1 ${filterArg}`;
  /** @type {PnpmListResultItem[]} */
  const packageData = JSON.parse(result.stdout);

  // Filter packages based on options
  const filteredPackages = packageData.flatMap((pkg) => {
    const isPrivate = pkg.private || !pkg.name || !pkg.version;
    if (publicOnly && isPrivate) {
      return [];
    }
    return [
      /** @type {PublicPackage | PrivatePackage} */ ({
        name: pkg.name,
        version: pkg.version,
        path: pkg.path,
        isPrivate,
      }),
    ];
  });

  if (nonPublishedOnly) {
    // Check if any of the packages are new/need manual publishing first.
    const filteredPublicPackages = filteredPackages.filter((pkg) => !pkg.isPrivate);

    const results = await Promise.all(
      filteredPublicPackages.map(async (pkg) => {
        const url = `${process.env.npm_config_registry || 'https://registry.npmjs.org'}/${pkg.name}`;
        return fetch(url).then((res) => res.status === 404);
      }),
    );
    return filteredPublicPackages.filter((_pkg, index) => !!results[index]);
  }

  return filteredPackages;
}

/**
 * Get package version info from registry
 * @param {string} packageName - Name of the package
 * @param {string} baseVersion - Base version to check
 * @returns {Promise<VersionInfo>} Version information
 */
export async function getPackageVersionInfo(packageName, baseVersion) {
  try {
    // Check if current stable version exists
    let currentVersionExists = false;
    try {
      await $`pnpm view ${packageName}@${baseVersion} version`;
      currentVersionExists = true;
    } catch {
      currentVersionExists = false;
    }

    // Get canary dist-tag to find latest canary version
    const canaryResult = await $`pnpm view ${packageName} dist-tags.canary`;
    const latestCanaryVersion = semver.valid(canaryResult.stdout.trim());

    return {
      currentVersionExists,
      latestCanaryVersion,
    };
  } catch (error) {
    return {
      currentVersionExists: false,
      latestCanaryVersion: null,
    };
  }
}

/**
 * @typedef {Object} PublishSummaryEntry
 * @property {string} name
 * @property {string} version
 */

/**
 * Publish packages with the given options
 * @param {PublicPackage[]} packages - Packages to publish
 * @param {PublishOptions} [options={}] - Publishing options
 * @returns {Promise<PublishSummaryEntry[]>}
 */
export async function publishPackages(packages, options = {}) {
  const args = [];
  const tag = options.tag ?? 'latest';

  // Add package filters
  packages.forEach((pkg) => {
    args.push('--filter', pkg.name);
  });

  // Add conditional flags
  if (options.dryRun) {
    args.push('--dry-run');
  }

  if (options.noGitChecks) {
    args.push('--no-git-checks');
  }

  const workspaceDir = await findWorkspaceDir(process.cwd());
  if (!workspaceDir) {
    throw new Error('Could not find pnpm workspace root');
  }
  const summaryPath = path.join(workspaceDir, 'pnpm-publish-summary.json');

  // Clean up any leftover summary file from a previous run
  await fs.rm(summaryPath, { force: true });

  await $({
    stdio: 'inherit',
    env: { npm_config_loglevel: 'warn' },
  })`pnpm -r publish --access public --tag=${tag} --report-summary ${args}`;

  const summary = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
  await fs.rm(summaryPath, { force: true });
  return /** @type {PublishSummaryEntry[]} */ (summary.publishedPackages);
}

/**
 * @typedef {Object} GetTransitiveDependenciesOptions
 * @property {Map<string, string>} [workspacePathByName] - Map of workspace package name to directory path
 * @property {boolean} [includeDev=true] - Whether to include devDependencies in the traversal
 */

/**
 * Get all transitive workspace dependencies for a set of packages.
 *
 * Only follows deps whose version spec starts with `workspace:` (e.g. `workspace:*`
 * or `workspace:^`), meaning they are sourced directly from the monorepo. Pinned
 * external versions (e.g. `^1.0.0`) are ignored even when the package name exists
 * in the workspace. Traverses `dependencies` and optionally `devDependencies`.
 * Results are cached per package so each package is read from disk at most once
 * regardless of how many roots depend on it.
 *
 * @param {string[]} packageNames - Package names to start the traversal from
 * @param {GetTransitiveDependenciesOptions} [options]
 * @returns {Promise<Set<string>>} All reachable workspace package names, including the input packages themselves
 */
export async function getTransitiveDependencies(packageNames, options = {}) {
  const { includeDev = true, workspacePathByName = new Map() } = options;

  /** @type {Map<string, Promise<Set<string>>>} */
  const cache = new Map();

  /**
   * @param {string} packageName
   * @returns {Promise<Set<string>>}
   */
  function collectDeps(packageName) {
    const cached = cache.get(packageName);
    if (cached) {
      return cached;
    }

    const promise = (async () => {
      const packagePath = workspacePathByName.get(packageName);
      if (!packagePath) {
        throw new Error(`Workspace "${packageName}" not found`);
      }

      const pkgJson = await readPackageJson(packagePath);
      const allDepEntries = [
        ...Object.entries(pkgJson.dependencies ?? {}),
        ...(includeDev ? Object.entries(pkgJson.devDependencies ?? {}) : []),
      ];
      const workspaceDeps = allDepEntries
        .filter(
          ([dep, spec]) =>
            workspacePathByName.has(dep) &&
            typeof spec === 'string' &&
            spec.startsWith('workspace:'),
        )
        .map(([dep]) => dep);

      const recursiveResults = await Promise.all(workspaceDeps.map(collectDeps));
      return new Set([...workspaceDeps, ...recursiveResults.flatMap((s) => [...s])]);
    })();

    cache.set(packageName, promise);
    return promise;
  }

  for (const name of packageNames) {
    if (!workspacePathByName.has(name)) {
      throw new Error(`Workspace "${name}" not found`);
    }
  }

  const results = await Promise.all(packageNames.map(collectDeps));
  return new Set([...packageNames, ...results.flatMap((s) => [...s])]);
}

/**
 * Pure validation logic: given a publish set and workspace maps, checks that all
 * transitive hard workspace dependencies are covered and none are private.
 *
 * A hard dependency is one listed in `dependencies` (not `peerDependencies` or
 * `devDependencies`) using a `workspace:` version specifier (e.g. `workspace:*` or
 * `workspace:^`). Peer dependencies are never bundled and dev dependencies are not installed
 * on consumer devices - both are excluded regardless of version specifier. Pinned-version
 * references in `dependencies` are also excluded - they resolve from the registry and do
 * not need to be co-published.
 *
 * @param {PublicPackage[]} packages - The packages intended for publishing
 * @param {Map<string, PublicPackage | PrivatePackage>} workspacePackageByName - All workspace packages by name
 * @param {Map<string, string>} workspacePathByName - Map of workspace package name to directory path
 * @returns {Promise<{issues: string[]}>}
 *   List of human-readable issue strings. Empty when the dependency set is valid.
 * @internal
 */
export async function checkPublishDependencies(
  packages,
  workspacePackageByName,
  workspacePathByName,
) {
  const publishedNames = new Set(packages.map((pkg) => pkg.name));

  const transitiveDeps = await getTransitiveDependencies(
    packages.map((pkg) => pkg.name),
    { includeDev: false, workspacePathByName },
  );

  /** @type {Set<string>} */
  const privateButRequired = new Set();
  /** @type {Set<string>} */
  const missingFromPublish = new Set();

  for (const depName of transitiveDeps) {
    if (publishedNames.has(depName)) {
      continue;
    }
    const workspacePkg = workspacePackageByName.get(depName);
    if (workspacePkg?.isPrivate) {
      privateButRequired.add(depName);
    } else {
      missingFromPublish.add(depName);
    }
  }

  /** @type {string[]} */
  const issues = [];

  if (privateButRequired.size > 0) {
    issues.push(
      `The following private workspace packages are required as dependencies but cannot be published: ${[...privateButRequired].join(', ')}`,
    );
  }

  if (missingFromPublish.size > 0) {
    issues.push(
      `The following workspace packages are required as dependencies but are not included in the publish set: ${[...missingFromPublish].join(', ')}. Add them to the --filter list.`,
    );
  }

  return { issues };
}

/**
 * Validate that a set of packages covers all of their transitive hard workspace dependencies,
 * and that none of those dependencies are private (which would make them unpublishable).
 *
 * @param {PublicPackage[]} packages - The packages intended for publishing
 * @returns {Promise<{issues: string[]}>}
 *   List of human-readable issue strings. Empty when the dependency set is valid.
 */
export async function validatePublishDependencies(packages) {
  const allWorkspacePackages = await getWorkspacePackages();

  const workspacePackageByName = /** @type {Map<string, PublicPackage | PrivatePackage>} */ (
    new Map(allWorkspacePackages.flatMap((pkg) => (pkg.name ? [[pkg.name, pkg]] : [])))
  );
  const workspacePathByName = new Map(
    allWorkspacePackages.flatMap((pkg) => (pkg.name ? [[pkg.name, pkg.path]] : [])),
  );

  return checkPublishDependencies(packages, workspacePackageByName, workspacePathByName);
}

/**
 * Read package.json from a directory
 * @param {string} packagePath - Path to package directory
 * @returns {Promise<import('../cli/packageJson').PackageJson>} Parsed package.json content
 */
export async function readPackageJson(packagePath) {
  const content = await fs.readFile(path.join(packagePath, 'package.json'), 'utf8');
  return JSON.parse(content);
}

/**
 * Write package.json to a directory
 * @param {string} packagePath - Path to package directory
 * @param {Object} packageJson - Package.json object to write
 * @returns {Promise<void>}
 */
export async function writePackageJson(packagePath, packageJson) {
  const content = `${JSON.stringify(packageJson, null, 2)}\n`;
  await fs.writeFile(path.join(packagePath, 'package.json'), content);
}

/**
 * Resolve a package@version specifier to an exact version
 * @param {string} packageSpec - Package specifier in format "package@version"
 * @returns {Promise<string>} Exact version string
 */
export async function resolveVersion(packageSpec) {
  const result = await $`pnpm info ${packageSpec} version --json`;
  const versions = JSON.parse(result.stdout);
  return typeof versions === 'string' ? versions : versions[versions.length - 1];
}

/**
 * Find the version of a dependency for a specific package@version
 * @param {string} packageSpec - Package specifier in format "package@version"
 * @param {string} dependency - Dependency name to look up
 * @returns {Promise<string>} Exact version string of the dependency
 */
export async function findDependencyVersionFromSpec(packageSpec, dependency) {
  const result = await $`pnpm info ${packageSpec} dependencies.${dependency}`;
  const spec = result.stdout.trim();
  return resolveVersion(`${dependency}@${spec}`);
}

/**
 * Get the maximum semver version between two versions
 * @param {string} a
 * @param {string} b
 * @returns {string} The maximum semver version
 */
export function semverMax(a, b) {
  return semver.gt(a, b) ? a : b;
}
