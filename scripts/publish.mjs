#!/usr/bin/env node

/* eslint-disable no-console */

import { $ } from 'execa';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as semver from 'semver';

const CANARY_TAG = 'canary';

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
 * Get all workspace packages that are public
 * @param {string|null} [sinceRef] - Git reference to filter changes since
 * @returns {Promise<Package[]>} Array of public packages
 */
async function getWorkspacePackages(sinceRef = null) {
  // Build command with conditional filter
  const filterArg = sinceRef ? ['--filter', `...[${sinceRef}]`] : [];
  const result = await $`pnpm ls -r --json --depth -1 ${filterArg}`;
  /** @type {PnpmListResultItem[]} */
  const packageData = JSON.parse(result.stdout);

  // Filter out private packages and format the response
  const publicPackages = packageData
    .filter((pkg) => !pkg.private)
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

  return publicPackages;
}

/**
 * Get package version info from registry
 * @param {string} packageName - Name of the package
 * @param {string} baseVersion - Base version to check
 * @returns {Promise<VersionInfo>} Version information
 */
async function getPackageVersionInfo(packageName, baseVersion) {
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
    let latestCanaryVersion = null;
    try {
      const canaryResult = await $`pnpm view ${packageName} dist-tags.canary`;
      const canaryTag = canaryResult.stdout.trim();

      // Check if canary tag matches our base version pattern
      if (canaryTag && canaryTag.startsWith(`${baseVersion}-canary.`)) {
        latestCanaryVersion = canaryTag;
      }
    } catch {
      // No canary dist-tag found, that's fine
    }

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
 * Get current git SHA
 * @returns {Promise<string>} Current git commit SHA
 */
async function getCurrentGitSha() {
  const result = await $`git rev-parse HEAD`;
  return result.stdout.trim();
}

/**
 * Check if the canary git tag exists
 * @returns {Promise<string|null>} Canary tag name if exists, null otherwise
 */
async function getLastCanaryTag() {
  try {
    await $`git rev-parse --verify ${CANARY_TAG}`;
    return CANARY_TAG;
  } catch {
    return null;
  }
}

/**
 * Create or update the canary git tag
 * @param {boolean} [dryRun=false] - Whether to run in dry-run mode
 * @returns {Promise<void>}
 */
async function createCanaryTag(dryRun = false) {
  try {
    if (dryRun) {
      console.log('🏷️  Would update and push canary tag (dry-run)');
    } else {
      await $`git tag -f ${CANARY_TAG}`;
      await $`git push origin ${CANARY_TAG} --force`;
      console.log('🏷️  Updated and pushed canary tag');
    }
  } catch (/** @type {any} */ error) {
    console.error('Failed to create/push canary tag:', error.message);
    throw error;
  }
}

/**
 * Publish packages with the given options
 * @param {Package[]} packages - Packages to publish
 * @param {string} tag - npm tag to publish with
 * @param {PublishOptions} [options={}] - Publishing options
 * @returns {Promise<void>}
 */
async function publishPackages(packages, tag, options = {}) {
  const args = [];

  // Add package filters
  packages.forEach((pkg) => {
    args.push('--filter', pkg.name);
  });

  // Add conditional flags
  if (options.provenance) {
    args.push('--provenance');
  }

  if (options.dryRun) {
    args.push('--dry-run');
  }

  if (options.noGitChecks) {
    args.push('--no-git-checks');
  }

  await $({ stdio: 'inherit' })`pnpm -r publish --tag=${tag} ${args}`;
}

/**
 * Read package.json from a directory
 * @param {string} packagePath - Path to package directory
 * @returns {Promise<Object>} Parsed package.json content
 */
async function readPackageJson(packagePath) {
  const content = await fs.readFile(path.join(packagePath, 'package.json'), 'utf8');
  return JSON.parse(content);
}

/**
 * Write package.json to a directory
 * @param {string} packagePath - Path to package directory
 * @param {Object} packageJson - Package.json object to write
 * @returns {Promise<void>}
 */
async function writePackageJson(packagePath, packageJson) {
  const content = `${JSON.stringify(packageJson, null, 2)}\n`;
  await fs.writeFile(path.join(packagePath, 'package.json'), content);
}

/**
 * Publish regular versions that don't exist on npm
 * @param {Package[]} packages - Packages to check for publishing
 * @param {Map<string, VersionInfo>} packageVersionInfo - Version info map
 * @param {PublishOptions} [options={}] - Publishing options
 * @returns {Promise<void>}
 */
async function publishRegularVersions(packages, packageVersionInfo, options = {}) {
  console.log('\n📦 Checking for unpublished regular versions...');

  const packagesToPublish = packages.filter((pkg) => {
    const versionInfo = packageVersionInfo.get(pkg.name);
    if (!versionInfo) {
      throw new Error(`No version info found for package ${pkg.name}`);
    }
    if (!versionInfo.currentVersionExists) {
      console.log(`📤 Will publish ${pkg.name}@${pkg.version}`);
      return true;
    }
    console.log(`⏭️  ${pkg.name}@${pkg.version} already exists, skipping`);
    return false;
  });

  if (packagesToPublish.length === 0) {
    console.log('No packages need to be published');
    return;
  }

  console.log(`Publishing ${packagesToPublish.length} packages...`);
  await publishPackages(packagesToPublish, 'latest', options);

  packagesToPublish.forEach((pkg) => {
    console.log(`✅ Published ${pkg.name}@${pkg.version}`);
  });
}

/**
 * Publish canary versions with updated dependencies
 * @param {Package[]} packagesToPublish - Packages that need canary publishing
 * @param {Package[]} allPackages - All workspace packages
 * @param {Map<string, VersionInfo>} packageVersionInfo - Version info map
 * @param {PublishOptions} [options={}] - Publishing options
 * @returns {Promise<void>}
 */
async function publishCanaryVersions(
  packagesToPublish,
  allPackages,
  packageVersionInfo,
  options = {},
) {
  console.log('\n🔥 Publishing canary versions...');

  // Early return if no packages need canary publishing
  if (packagesToPublish.length === 0) {
    console.log('✅ No packages have changed since last canary publish');
    await createCanaryTag(options.dryRun);
    return;
  }

  const gitSha = await getCurrentGitSha();
  const canaryVersions = new Map();
  const originalPackageJsons = new Map();

  // First pass: determine canary version numbers for all packages
  const changedPackageNames = new Set(packagesToPublish.map((pkg) => pkg.name));

  for (const pkg of allPackages) {
    const versionInfo = packageVersionInfo.get(pkg.name);
    if (!versionInfo) {
      throw new Error(`No version info found for package ${pkg.name}`);
    }

    if (changedPackageNames.has(pkg.name)) {
      // Generate new canary version for changed packages
      const baseVersion =
        versionInfo.latestCanaryVersion || semver.inc(pkg.version, 'patch') || '0.0.0';
      const canaryVersion = semver.inc(baseVersion, 'prerelease', 'canary');
      canaryVersions.set(pkg.name, canaryVersion);
      console.log(`🏷️  ${pkg.name}: ${canaryVersion} (new)`);
    } else if (versionInfo.latestCanaryVersion) {
      // Reuse existing canary version for unchanged packages
      canaryVersions.set(pkg.name, versionInfo.latestCanaryVersion);
      console.log(`🏷️  ${pkg.name}: ${versionInfo.latestCanaryVersion} (reused)`);
    }
  }

  // Second pass: read and update ALL package.json files in parallel
  const packageUpdatePromises = allPackages.map(async (pkg) => {
    const originalPackageJson = await readPackageJson(pkg.path);

    const canaryVersion = canaryVersions.get(pkg.name);
    if (canaryVersion) {
      const updatedPackageJson = {
        ...originalPackageJson,
        version: canaryVersion,
        gitSha,
      };

      await writePackageJson(pkg.path, updatedPackageJson);
      console.log(`📝 Updated ${pkg.name} package.json to ${canaryVersion}`);
    }

    return { pkg, originalPackageJson };
  });

  const updateResults = await Promise.all(packageUpdatePromises);

  // Build the original package.json map
  for (const { pkg, originalPackageJson } of updateResults) {
    originalPackageJsons.set(pkg.name, originalPackageJson);
  }

  // Third pass: publish only the changed packages using recursive publish
  let publishSuccess = false;
  try {
    console.log(`📤 Publishing ${packagesToPublish.length} canary versions...`);
    await publishPackages(packagesToPublish, 'canary', { ...options, noGitChecks: true });

    packagesToPublish.forEach((pkg) => {
      const canaryVersion = canaryVersions.get(pkg.name);
      console.log(`✅ Published ${pkg.name}@${canaryVersion}`);
    });
    publishSuccess = true;
  } finally {
    // Always restore original package.json files in parallel
    console.log('\n🔄 Restoring original package.json files...');
    const restorePromises = allPackages.map(async (pkg) => {
      const originalPackageJson = originalPackageJsons.get(pkg.name);
      await writePackageJson(pkg.path, originalPackageJson);
    });

    await Promise.all(restorePromises);
  }

  if (publishSuccess) {
    // Create/update the canary tag after successful publish
    await createCanaryTag(options.dryRun);
    console.log('\n🎉 All canary versions published successfully!');
  }
}

/**
 * Main publishing function
 * @returns {Promise<void>}
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const canaryOnly = args.includes('--canary-only');
  const provenance = args.includes('--provenance');

  const options = { dryRun, provenance };

  if (dryRun) {
    console.log('🧪 Running in DRY RUN mode - no actual publishing will occur\n');
  }

  if (provenance) {
    console.log('🔐 Provenance enabled - packages will include provenance information\n');
  }

  // Always get all packages first
  console.log('🔍 Discovering all workspace packages...');
  const allPackages = await getWorkspacePackages();

  if (allPackages.length === 0) {
    console.log('⚠️  No public packages found in workspace');
    return;
  }

  // Check for canary tag to determine selective publishing
  const canaryTag = await getLastCanaryTag();

  console.log(
    canaryTag
      ? '🔍 Checking for packages changed since canary tag...'
      : '🔍 No canary tag found, will publish all packages',
  );
  const packages = canaryTag ? await getWorkspacePackages(canaryTag) : allPackages;

  console.log(`📋 Found ${packages.length} packages that need canary publishing:`);
  packages.forEach((pkg) => {
    console.log(`   • ${pkg.name}@${pkg.version}`);
  });

  // Fetch version info for all packages in parallel
  console.log('\n🔍 Fetching package version information...');
  const versionInfoPromises = allPackages.map(async (pkg) => {
    const versionInfo = await getPackageVersionInfo(pkg.name, pkg.version);
    return { packageName: pkg.name, versionInfo };
  });

  const versionInfoResults = await Promise.all(versionInfoPromises);
  const packageVersionInfo = new Map();

  for (const { packageName, versionInfo } of versionInfoResults) {
    packageVersionInfo.set(packageName, versionInfo);
  }

  if (!canaryOnly) {
    await publishRegularVersions(allPackages, packageVersionInfo, options);
  }

  await publishCanaryVersions(packages, allPackages, packageVersionInfo, options);

  console.log('\n🏁 Publishing complete!');
}

// Run the script
main();
