#!/usr/bin/env node

import { $ } from 'execa';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as semver from 'semver';

/**
 * @typedef {Object} Package
 * @property {string} name - Package name
 * @property {string} version - Package version
 * @property {string} path - Package directory path
 */

/**
 * @typedef {Object} VersionInfo
 * @property {boolean} currentVersionExists - Whether current version exists on npm
 * @property {string|null} latestCanaryVersion - Latest canary version if available
 */

/**
 * @typedef {Object} PublishOptions
 * @property {boolean} [dryRun] - Whether to run in dry-run mode
 * @property {boolean} [provenance] - Whether to include provenance information
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
 */

/**
 * Get workspace packages with optional filtering
 * @param {GetWorkspacePackagesOptions} [options={}] - Options for filtering packages
 * @returns {Promise<Package[]>} Array of packages
 */
export async function getWorkspacePackages(options = {}) {
  const { sinceRef = null, publicOnly = false } = options;

  // Build command with conditional filter
  const filterArg = sinceRef ? ['--filter', `...[${sinceRef}]`] : [];
  const result = await $`pnpm ls -r --json --depth -1 ${filterArg}`;
  /** @type {PnpmListResultItem[]} */
  const packageData = JSON.parse(result.stdout);

  // Filter packages based on options
  const filteredPackages = packageData
    .filter((pkg) => !publicOnly || !pkg.private)
    .map((pkg) => {
      if (!pkg.name || !pkg.version) {
        throw new Error(`Invalid package data: ${JSON.stringify(pkg)}`);
      }
      return {
        name: pkg.name,
        version: pkg.version,
        path: pkg.path,
      };
    });

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
 * Publish packages with the given options
 * @param {string} tag - npm tag to publish with
 * @param {PublishOptions} [options={}] - Publishing options
 * @returns {Promise<void>}
 */
export async function publishPackages(tag, options = {}) {
  const args = [];

  // Add conditional flags
  if (options.dryRun) {
    args.push('--dry-run');
  }

  if (options.noGitChecks) {
    args.push('--no-git-checks');
  }

  // Set up environment variables
  /** @type {Record<string, string>} */
  const env = {};
  if (options.provenance) {
    env.NPM_CONFIG_PROVENANCE = 'true';
  }

  await $({ stdio: 'inherit', env })`pnpm -r publish --access public --tag=${tag} ${args}`;
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
 * Get the maximum semver version between two versions
 * @param {string} a
 * @param {string} b
 * @returns {string} The maximum semver version
 */
export function semverMax(a, b) {
  return semver.gt(a, b) ? a : b;
}
