#!/usr/bin/env node

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
 * @property {boolean} [publishedOnly=false] - Whether to filter to only published packages
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
  const { sinceRef = null, publicOnly = false, publishedOnly = false } = options;

  // Build command with conditional filter
  const filterArg = sinceRef ? ['--filter', `...[${sinceRef}]`] : [];
  const result = await $`pnpm ls -r --json --depth -1 ${filterArg}`;
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

  // Filter by published status if requested
  if (publishedOnly) {
    const publishStatusMap = await getPackagePublishStatusMap(filteredPackages);
    return filteredPackages.filter((pkg) => publishStatusMap.get(pkg.path) === true);
  }

  return filteredPackages;
}

/**
 * Check if a package is published to npm registry
 * @param {string} packageName - Name of the package
 * @returns {Promise<boolean>} Whether the package is published
 */
export async function isPackagePublished(packageName) {
  try {
    await $`pnpm view ${packageName} version`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Get published status for multiple packages
 * @param {(PrivatePackage | PublicPackage)[]} packages - Array of packages to check
 * @returns {Promise<Map<string, boolean>>} Map from package path to published status
 */
export async function getPackagePublishStatusMap(packages) {
  /** @type {[string, boolean][]} */
  const publishedChecks = await Promise.all(
    packages.map(async (pkg) => {
      // Skip packages without names (private packages might not have names)
      if (!pkg.name) {
        return [pkg.path, false];
      }
      const isPublished = await isPackagePublished(pkg.name);
      return [pkg.path, isPublished];
    }),
  );

  return new Map(publishedChecks);
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
 * Publish packages with the given options
 * @param {PublicPackage[]} packages - Packages to publish
 * @param {string} tag - npm tag to publish with
 * @param {PublishOptions} [options={}] - Publishing options
 * @returns {Promise<void>}
 */
export async function publishPackages(packages, tag, options = {}) {
  const args = [];

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

  await $({ stdio: 'inherit' })`pnpm -r publish --access public --tag=${tag} ${args}`;
}

/**
 * Read package.json from a directory
 * @param {string} packagePath - Path to package directory
 * @returns {Promise<Object>} Parsed package.json content
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
 * Get current git SHA
 * @returns {Promise<string>} Current git commit SHA
 */
export async function getCurrentGitSha() {
  const result = await $`git rev-parse HEAD`;
  return result.stdout.trim();
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
