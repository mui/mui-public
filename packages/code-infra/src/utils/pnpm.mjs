#!/usr/bin/env node

import { getPublishedByPolicy } from '@pnpm/config.version-policy';
import { parseWantedDependency } from '@pnpm/parse-wanted-dependency';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { $ } from 'execa';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as semver from 'semver';
import { parseDocument, isMap } from 'yaml';

/** Canonical npm registry URL, in the form `getPublishRegistry` returns. */
const NPMJS_REGISTRY = 'https://registry.npmjs.org/';

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
  const { sinceRef = null, publicOnly = false, filter = [] } = options;

  /**
   * Run `pnpm ls` with the given --filter args and return the parsed list.
   * @param {string[]} filterArg
   * @returns {Promise<PnpmListResultItem[]>}
   */
  const listPackages = async (filterArg) => {
    const result = await $({ cwd: options.cwd })`pnpm ls -r --json --depth -1 ${filterArg}`;
    return JSON.parse(result.stdout);
  };

  // pnpm ORs --filter args, so intersect "matches filter" with "changed since ref"
  // in JS. The `...[ref]` selector includes dependents of changed packages, so a
  // package whose `workspace:*` dependency changed is treated as changed too. This
  // keeps consumers from getting duplicate copies when only a leaf package is
  // republished but its dependents still pin the previous version.
  const patternFilterArg = filter.flatMap((f) => ['--filter', f]);
  const [candidatePackages, changedPackages] = await Promise.all([
    listPackages(patternFilterArg),
    // null when no sinceRef (skip the constraint); [] when nothing changed.
    sinceRef ? listPackages(['--filter', `...[${sinceRef}]`]) : Promise.resolve(null),
  ]);
  let packageData = candidatePackages;
  if (changedPackages) {
    // sinceRef given but nothing changed → no packages, regardless of filter.
    if (changedPackages.length === 0) {
      return [];
    }
    const changedPaths = new Set(changedPackages.map((pkg) => pkg.path));
    packageData = packageData.filter((pkg) => changedPaths.has(pkg.path));
  }

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

  return filteredPackages;
}

/**
 * Resolve the registry a package will be published to.
 *
 * Only `publishConfig.registry` and the ambient `npm_config_registry` are
 * consulted — `.npmrc` layering and `@scope:registry` entries are not.
 *
 * @param {string} packagePath - Path to the package directory
 * @returns {Promise<string>} Normalized registry URL, ending in a slash
 */
export async function getPublishRegistry(packagePath) {
  const packageJson = await readPackageJson(packagePath);
  const registry =
    packageJson.publishConfig?.registry || process.env.npm_config_registry || NPMJS_REGISTRY;

  // Normalizing through the URL parser keeps host casing and default ports from
  // defeating the equality check in `requiresTrustedPublisherBootstrap`. The
  // trailing slash is required because `new URL(name, base)` replaces the last
  // path segment of a base that lacks one, mangling registries served under a
  // path prefix such as Artifactory's `/api/npm/<repo>`.
  let registryUrl;
  try {
    registryUrl = new URL(registry);
  } catch (error) {
    // Node's own message names neither the offending value nor where it came
    // from, leaving the operator to bisect package.json files mid-release.
    throw new Error(
      `Invalid publish registry ${JSON.stringify(registry)} for the package at ${packagePath}`,
      { cause: error },
    );
  }
  registryUrl.pathname = `${registryUrl.pathname.replace(/\/+$/, '')}/`;
  return registryUrl.href;
}

/**
 * Get the version to release from the workspace-root package.json.
 *
 * Resolves the workspace root so the version is the monorepo's regardless of
 * which directory publish runs from.
 *
 * @param {string} [cwd] - Directory to resolve the workspace root from
 * @returns {Promise<string | null>} Version string, or null when absent/invalid
 */
export async function getReleaseVersion(cwd = process.cwd()) {
  const workspaceDir = (await findWorkspaceDir(cwd)) ?? cwd;
  const { version } = await readPackageJson(workspaceDir);
  return version ? semver.valid(version) : null;
}

/**
 * Whether a registry requires a package to exist before CI can publish to it.
 * @param {string} registry - Normalized registry URL
 * @returns {boolean}
 */
function requiresTrustedPublisherBootstrap(registry) {
  // npm won't attach a Trusted Publisher to a name that doesn't exist yet. No
  // other registry we publish to has an equivalent step.
  return registry === NPMJS_REGISTRY;
}

/**
 * Filter to the packages that must be published by hand before CI can take over.
 *
 * A brand new package has to be pushed once manually (see
 * `code-infra publish-new-package`) before the OIDC-based workflow can publish
 * it, so the release fails with a clear message instead of a confusing 404
 * midway through. See {@link getPackageVersionInfo} for the version-level check.
 *
 * @param {PublicPackage[]} packages - Packages to check
 * @returns {Promise<PublicPackage[]>} The subset needing a manual first publish
 */
export async function getPackagesNeedingManualPublish(packages) {
  const results = await Promise.all(
    packages.map(async (pkg) => {
      const registry = await getPublishRegistry(pkg.path);
      if (!requiresTrustedPublisherBootstrap(registry)) {
        return false;
      }

      // HEAD, because only the status matters — a packument runs to megabytes.
      const res = await fetch(new URL(pkg.name, registry), { method: 'HEAD' });
      if (res.status === 404) {
        return true;
      }
      if (!res.ok) {
        // Anything else (401, 5xx, a proxy hiccup) tells us nothing about
        // whether the package exists. Treating it as "already published" would
        // silently disable the check, so fail loudly instead.
        throw new Error(
          `Failed to check whether ${pkg.name} exists on ${registry}: HTTP ${res.status}`,
        );
      }
      return false;
    }),
  );

  return packages.filter((_pkg, index) => results[index]);
}

/**
 * Get package version info from registry.
 *
 * Resolves through `pnpm view`, which reports a lookup failure the same way it
 * reports a missing version. Use {@link getPackagesNeedingManualPublish} where
 * absence has to be told apart from an error.
 *
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
 * The package a `workspace:` alias spec resolves to, if it is one.
 *
 * @param {string} spec - Dependency spec
 * @returns {string | null} The aliased package name, or null for a plain spec
 */
function aliasTarget(spec) {
  if (!spec.startsWith('workspace:')) {
    return null;
  }
  const { alias, bareSpecifier } = parseWantedDependency(spec.slice('workspace:'.length));
  // A plain range parses as one half or the other (`*` as an alias, `^1.0.0` as a
  // specifier); only an aliased spec carries both.
  return bareSpecifier === undefined ? null : (alias ?? null);
}

/**
 * Get all transitive workspace dependencies for a set of packages.
 *
 * Only follows deps whose version spec starts with `workspace:` (e.g. `workspace:*`
 * or `workspace:^`), meaning they are sourced directly from the monorepo. An
 * alias spec (`workspace:@scope/name@range`) is followed to the package it
 * targets, which need not match the dependency key. Pinned
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
      const workspaceDeps = allDepEntries.flatMap(([dep, spec]) => {
        if (typeof spec !== 'string' || !spec.startsWith('workspace:')) {
          return [];
        }
        // An aliased spec (`workspace:@scope/name@range`) names the workspace
        // package it resolves to, which need not match the dependency key.
        const name = aliasTarget(spec) ?? dep;
        return workspacePathByName.has(name) ? [name] : [];
      });

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
 * Write the computed overrides into whichever manifest already defines
 * overrides — preferring pnpm-workspace.yaml, falling back to package.json
 * `pnpm.overrides`, defaulting to pnpm-workspace.yaml — and persist the result.
 * A missing pnpm-workspace.yaml is treated as empty, so a fresh file is created
 * with just the `overrides:` block. Rejects a `resolutions` field in
 * package.json because pnpm 11 silently ignores it.
 *
 * @param {string} workspaceDir - Workspace root directory
 * @param {Record<string, string>} overrides - Overrides to apply
 * @returns {Promise<void>}
 */
export async function writeOverridesToWorkspace(workspaceDir, overrides) {
  const workspaceYamlPath = path.join(workspaceDir, 'pnpm-workspace.yaml');
  const yamlPromise = fs.readFile(workspaceYamlPath, { encoding: 'utf8' }).catch((error) => {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
      throw error;
    }
    return '';
  });
  const [rootPackageJson, yamlSource] = await Promise.all([
    readPackageJson(workspaceDir),
    yamlPromise,
  ]);

  const { resolutions } = rootPackageJson;
  if (resolutions && Object.keys(resolutions).length > 0) {
    throw new Error(
      'Found a "resolutions" field in package.json. pnpm 11 ignores it silently. ' +
        'Move those entries into the "overrides:" key of pnpm-workspace.yaml.',
    );
  }

  // Parsed once, reused for both the read (does it have overrides?) and the write.
  const doc = parseDocument(yamlSource);
  const existing = doc.get('overrides');
  const workspaceHasOverrides = isMap(existing) && existing.items.length > 0;

  const pnpm = /** @type {{ overrides?: Record<string, string> } | undefined} */ (
    rootPackageJson.pnpm
  );
  const packageJsonOverrides = pnpm?.overrides;

  // Write where overrides already live; default to the workspace file.
  if (
    !workspaceHasOverrides &&
    packageJsonOverrides &&
    Object.keys(packageJsonOverrides).length > 0
  ) {
    await writePackageJson(workspaceDir, {
      ...rootPackageJson,
      pnpm: { ...pnpm, overrides: { ...packageJsonOverrides, ...overrides } },
    });
    return;
  }

  for (const [name, version] of Object.entries(overrides)) {
    doc.setIn(['overrides', name], version);
  }
  await fs.writeFile(workspaceYamlPath, doc.toString());
}

/**
 * Map a package name onto a different npm scope.
 * @param {string} name - Package name, e.g. `@base-ui/mosaic`
 * @param {string} fromScope - Scope to replace, e.g. `@base-ui`
 * @param {string} toScope - Replacement scope, e.g. `@base-ui-private`
 * @returns {string | null} The renamed package, or null when the scope doesn't match
 */
function renameScope(name, fromScope, toScope) {
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
 * @param {(PublicPackage | PrivatePackage)[]} packages - All workspace packages
 * @param {string} fromScope - Scope to move away from
 * @param {string} toScope - Scope to move to
 * @returns {Promise<Map<string, string>>} Old package name to new package name
 */
export async function renameWorkspaceScope(packages, fromScope, toScope) {
  // Renaming a scope onto itself only rewrites every manifest to itself. The
  // CLI rejects this earlier, but the guard belongs with the operation so a
  // direct caller cannot trip the silent churn either.
  if (fromScope === toScope) {
    throw new Error(`Cannot rename ${fromScope} to itself.`);
  }

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

  // A rename that lands on a name another package keeps would leave the
  // workspace with two packages sharing a name. Catch it up front, before any
  // manifest is written.
  /** @type {Map<string, string>} */
  const finalNames = new Map();
  for (const pkg of packages) {
    if (!pkg.name) {
      continue;
    }
    const finalName = renamed.get(pkg.name) ?? pkg.name;
    const owner = finalNames.get(finalName);
    if (owner) {
      throw new Error(
        `Cannot rename ${fromScope} to ${toScope}: ${pkg.name} and ${owner} would both be named ${finalName}.`,
      );
    }
    finalNames.set(finalName, pkg.name);
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
        if (!deps) {
          continue;
        }
        for (const [depName, spec] of Object.entries(deps)) {
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

/**
 * The versions a `minimumReleaseAgeExclude` policy exempts from the cooldown. A
 * policy answers `true` for a package that is exempt at any version, or the list
 * of versions exempted individually.
 *
 * @param {import('@pnpm/config.version-policy').PublishedByPolicy} policy - Policy from {@link getMinimumReleaseAgePolicy}
 * @param {string} name - Package name
 * @returns {true | string[]} `true` when every version is exempt, otherwise the exempt versions
 */
function cooldownExemptions(policy, name) {
  const exemption = policy.publishedByExclude?.(name);
  if (exemption === true) {
    return true;
  }
  return Array.isArray(exemption) ? exemption : [];
}

/**
 * Pick the version to pin for a specifier whose newest match is too recent to
 * satisfy a `minimumReleaseAge` cooldown.
 *
 * Only the three specifier shapes this tool is given are handled. An exact
 * version is not a choice, so it stands and the install reports it. A range
 * resolves within itself. A dist-tag repoints to the highest aged-in version
 * sharing the major and prerelease-ness — except `latest`, which pnpm allows to
 * cross majors. Unlike pnpm, a deprecated version is not passed over: `pnpm info`
 * lists bare version strings, so that flag would cost a request per candidate.
 *
 * @param {string} requested - The specifier as given: a dist-tag, range or exact version
 * @param {string} resolvedVersion - Version the specifier resolves to today
 * @param {string[]} versions - Every published version, from `pnpm info <pkg> versions`
 * @param {Record<string, string>} publishTimes - Version to ISO publish date, from `pnpm info <pkg> time`
 * @param {number} cutoff - Epoch ms; versions published after this are too recent
 * @param {string[]} [exemptVersions] - Versions `minimumReleaseAgeExclude` installs regardless of age
 * @returns {string | null} Version to pin, or null when nothing qualifies
 * @internal exported for unit tests
 */
export function selectAgedVersion(
  requested,
  resolvedVersion,
  versions,
  publishTimes,
  cutoff,
  exemptVersions = [],
) {
  const exempt = new Set(exemptVersions);

  /**
   * Whether the install would accept this version: old enough, or excluded from
   * the cooldown altogether.
   *
   * @param {string} version
   * @returns {boolean}
   */
  const isInstallable = (version) => {
    if (exempt.has(version)) {
      return true;
    }
    const published = Date.parse(publishTimes[version]);
    return Number.isFinite(published) && published <= cutoff;
  };

  // An unknown publish date leaves nothing to compare against, so the
  // resolution stands rather than being swapped for another build.
  if (!Object.hasOwn(publishTimes, resolvedVersion) || isInstallable(resolvedVersion)) {
    return resolvedVersion;
  }

  if (semver.valid(requested)) {
    return resolvedVersion;
  }

  // `time` keeps an entry for a version after it is unpublished, so candidates
  // come from the version list rather than from the dates.
  const candidates = versions.filter(isInstallable);

  if (semver.validRange(requested)) {
    return semver.maxSatisfying(candidates, requested, true);
  }

  const resolved = semver.parse(resolvedVersion, true);
  if (!resolved) {
    return resolvedVersion;
  }
  const resolvedIsPrerelease = resolved.prerelease.length > 0;

  let best = null;
  for (const version of candidates) {
    const parsed = semver.parse(version, true);
    if (
      !parsed ||
      (requested !== 'latest' && parsed.major !== resolved.major) ||
      parsed.prerelease.length > 0 !== resolvedIsPrerelease
    ) {
      continue;
    }
    if (!best || semver.gt(version, best, true)) {
      best = version;
    }
  }
  return best;
}

/**
 * Read the effective pnpm configuration, including everything resolved from
 * pnpm-workspace.yaml. `config list` types the values and omits unset keys,
 * where `config get` stringifies everything and prints `undefined`.
 *
 * @returns {Promise<Record<string, any>>} Parsed configuration
 */
export async function readPnpmConfig() {
  const result = await $`pnpm config list --json`;
  return JSON.parse(result.stdout);
}

/**
 * Read the registry cooldown from pnpm config, so resolution stays in step with
 * what the subsequent install will enforce.
 *
 * @returns {Promise<import('@pnpm/config.version-policy').PublishedByPolicy>} Cutoff date and exemption policy, both undefined when no cooldown is configured
 */
export async function getMinimumReleaseAgePolicy() {
  const config = await readPnpmConfig();
  // pnpm's own parser, so exclude entries keep their full grammar — wildcards,
  // version unions (`pkg@1.0.0 || 2.0.0`) and `!` negation.
  return getPublishedByPolicy({
    minimumReleaseAge: config.minimumReleaseAge,
    minimumReleaseAgeExclude: config.minimumReleaseAgeExclude,
  });
}

/**
 * Resolve a package@version specifier to an exact version.
 *
 * Given a cooldown policy, the result is the newest version the install will
 * actually accept — a dist-tag on a daily channel always points at a build too
 * recent to install under one. See {@link selectAgedVersion}.
 *
 * @param {string} packageSpec - Package specifier in format "package@version"
 * @param {import('@pnpm/config.version-policy').PublishedByPolicy} policy - Cooldown from {@link getMinimumReleaseAgePolicy}
 * @returns {Promise<string>} Exact version string
 */
export async function resolveVersion(packageSpec, policy) {
  // The unprojected document carries both the resolved version and every
  // publish date, so honouring the cooldown costs no extra round-trip.
  const info = JSON.parse((await $`pnpm info ${packageSpec} --json`).stdout);
  const manifest = Array.isArray(info) ? info[info.length - 1] : info;
  const { name, version: exactVersion, time: publishTimes = {}, versions = [] } = manifest;

  if (!policy.publishedBy) {
    return exactVersion;
  }

  const exemptVersions = cooldownExemptions(policy, name);
  if (exemptVersions === true || exemptVersions.includes(exactVersion)) {
    return exactVersion;
  }

  const cutoff = policy.publishedBy.toISOString();
  const { bareSpecifier: requested } = parseWantedDependency(packageSpec);
  const agedVersion = selectAgedVersion(
    requested ?? '',
    exactVersion,
    versions,
    publishTimes,
    policy.publishedBy.getTime(),
    exemptVersions,
  );

  if (!agedVersion) {
    throw new Error(
      `No version matching ${packageSpec} was published before the minimumReleaseAge cutoff ` +
        `(${cutoff}). The newest match, ${exactVersion}, was published at ` +
        `${publishTimes[exactVersion]}, and no earlier match qualifies. Lower ` +
        `minimumReleaseAge, add ${name} to minimumReleaseAgeExclude, or wait for ${exactVersion} ` +
        `to age in.`,
    );
  }

  if (agedVersion !== exactVersion) {
    // eslint-disable-next-line no-console
    console.log(
      `Resolved ${packageSpec} to ${agedVersion} rather than ${exactVersion}, which was published after the minimumReleaseAge cutoff (${cutoff}).`,
    );
  }

  return agedVersion;
}

/**
 * Find the version of a dependency for a specific package@version
 *
 * The parent's spec is often a range, so the cooldown applies here too. Stepping
 * back stays within that range and so never contradicts the parent.
 *
 * @param {string} packageSpec - Package specifier in format "package@version"
 * @param {string} dependency - Dependency name to look up
 * @param {import('@pnpm/config.version-policy').PublishedByPolicy} policy - Registry cooldown to resolve within
 * @returns {Promise<string>} Exact version string of the dependency
 */
export async function findDependencyVersionFromSpec(packageSpec, dependency, policy) {
  const result = await $`pnpm info ${packageSpec} dependencies.${dependency}`;
  const spec = result.stdout.trim();
  return resolveVersion(`${dependency}@${spec}`, policy);
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
