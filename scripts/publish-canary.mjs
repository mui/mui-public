#!/usr/bin/env node

/* eslint-disable no-console */

import { $ } from 'execa';
import * as semver from 'semver';

/**
 * @typedef {import('./shared/pnpm.mjs').Package} Package
 * @typedef {import('./shared/pnpm.mjs').VersionInfo} VersionInfo
 * @typedef {import('./shared/pnpm.mjs').PublishOptions} PublishOptions
 */

import {
  getWorkspacePackages,
  getPackageVersionInfo,
  publishPackages,
  readPackageJson,
  writePackageJson,
  getCurrentGitSha,
  semverMax,
} from './shared/pnpm.mjs';

const CANARY_TAG = 'canary';

/**
 * Check if the canary git tag exists
 * @returns {Promise<string|null>} Canary tag name if exists, null otherwise
 */
async function getLastCanaryTag() {
  // Remove local canary tag first to avoid conflicts during fetch
  try {
    await $`git tag -d ${CANARY_TAG}`;
  } catch {
    // Tag might not exist locally, which is fine
  }

  await $`git fetch origin tag ${CANARY_TAG}`;
  const { stdout: remoteCanaryTag } = await $`git ls-remote --tags origin ${CANARY_TAG}`;
  return remoteCanaryTag.trim() ? CANARY_TAG : null;
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
      const baseVersion = versionInfo.latestCanaryVersion
        ? semverMax(versionInfo.latestCanaryVersion, pkg.version)
        : pkg.version;
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

  // Run release build after updating package.json files
  console.log('\n🔨 Running release build...');
  await $`pnpm release:build`;
  console.log('✅ Release build completed successfully');

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

  await publishCanaryVersions(packages, allPackages, packageVersionInfo, options);

  console.log('\n🏁 Publishing complete!');
}

// Run the script
main();
