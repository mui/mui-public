#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * @typedef {import('./shared/pnpm.mjs').Package} Package
 * @typedef {import('./shared/pnpm.mjs').VersionInfo} VersionInfo
 * @typedef {import('./shared/pnpm.mjs').PublishOptions} PublishOptions
 */

import { getWorkspacePackages, getPackageVersionInfo, publishPackages } from './shared/pnpm.mjs';

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

  // Get all packages
  console.log('🔍 Discovering all workspace packages...');
  const allPackages = await getWorkspacePackages();

  if (allPackages.length === 0) {
    console.log('⚠️  No public packages found in workspace');
    return;
  }

  console.log(`📋 Found ${allPackages.length} packages:`);
  allPackages.forEach((pkg) => {
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

  await publishRegularVersions(allPackages, packageVersionInfo, options);

  console.log('\n🏁 Publishing complete!');
}

// Run the script
main();
