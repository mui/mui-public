#!/usr/bin/env node

/* eslint-disable no-console */

import { $ } from 'execa';
import fs from 'fs/promises';
import path from 'path';

/**
 * Get all workspace packages that are public
 */
async function getWorkspacePackages() {
  const result = await $`pnpm ls -r --parseable --depth -1`;
  const packagePaths = result.stdout.trim().split('\n').filter(Boolean);

  // Read all package.json files in parallel
  const packageJsonPromises = packagePaths.map(async (packagePath) => {
    const packageJsonPath = path.join(packagePath, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    return { packagePath, packageJson };
  });

  const packageResults = await Promise.all(packageJsonPromises);

  // Filter out private packages
  const publicPackages = packageResults
    .filter(({ packageJson }) => !packageJson.private)
    .map(({ packagePath, packageJson }) => ({
      name: packageJson.name,
      version: packageJson.version,
      path: packagePath,
      packageJson,
    }));

  return publicPackages;
}

/**
 * Get package version info from registry
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
 * Get the next canary number
 */
function getNextCanaryNumber(latestCanaryVersion) {
  if (!latestCanaryVersion) {
    return 0;
  }

  const match = latestCanaryVersion.match(/canary\.(\d+)$/);
  return match ? parseInt(match[1], 10) + 1 : 0;
}

/**
 * Get current git SHA
 */
async function getCurrentGitSha() {
  const result = await $`git rev-parse HEAD`;
  return result.stdout.trim();
}

/**
 * Publish packages with the given options
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
 */
async function readPackageJson(packagePath) {
  const content = await fs.readFile(path.join(packagePath, 'package.json'), 'utf8');
  return JSON.parse(content);
}

/**
 * Write package.json to a directory
 */
async function writePackageJson(packagePath, packageJson) {
  const content = `${JSON.stringify(packageJson, null, 2)}\n`;
  await fs.writeFile(path.join(packagePath, 'package.json'), content);
}

/**
 * Publish regular versions that don't exist on npm
 */
async function publishRegularVersions(packages, packageVersionInfo, options = {}) {
  console.log('\n📦 Checking for unpublished regular versions...');

  const packagesToPublish = packages.filter((pkg) => {
    const { currentVersionExists } = packageVersionInfo.get(pkg.name);
    if (!currentVersionExists) {
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
 */
async function publishCanaryVersions(packages, packageVersionInfo, options = {}) {
  console.log('\n🔥 Publishing canary versions...');

  const gitSha = await getCurrentGitSha();
  const canaryVersions = new Map();
  const originalPackageJsons = new Map();

  // First pass: determine all canary version numbers
  const canaryResults = packages.map((pkg) => {
    const { latestCanaryVersion } = packageVersionInfo.get(pkg.name);
    const nextCanaryNumber = getNextCanaryNumber(latestCanaryVersion);
    const canaryVersion = `${pkg.version}-canary.${nextCanaryNumber}`;

    console.log(`🏷️  ${pkg.name}: ${canaryVersion}`);
    return { pkg, canaryVersion };
  });

  // Build the canary versions map
  for (const { pkg, canaryVersion } of canaryResults) {
    canaryVersions.set(pkg.name, canaryVersion);
  }

  // Second pass: read and update package.json files in parallel
  const packageUpdatePromises = packages.map(async (pkg) => {
    const originalPackageJson = await readPackageJson(pkg.path);

    const canaryVersion = canaryVersions.get(pkg.name);
    const updatedPackageJson = {
      ...originalPackageJson,
      version: canaryVersion,
      gitSha,
    };

    await writePackageJson(pkg.path, updatedPackageJson);

    console.log(`📝 Updated ${pkg.name} package.json for canary release`);
    return { pkg, originalPackageJson };
  });

  const updateResults = await Promise.all(packageUpdatePromises);

  // Build the original package.json map
  for (const { pkg, originalPackageJson } of updateResults) {
    originalPackageJsons.set(pkg.name, originalPackageJson);
  }

  // Third pass: publish all canary versions using recursive publish
  let publishSuccess = false;
  try {
    console.log('📤 Publishing all canary versions...');
    await publishPackages(packages, 'canary', { ...options, noGitChecks: true });

    packages.forEach((pkg) => {
      const canaryVersion = canaryVersions.get(pkg.name);
      console.log(`✅ Published ${pkg.name}@${canaryVersion}`);
    });
    publishSuccess = true;
  } finally {
    // Always restore original package.json files in parallel
    console.log('\n🔄 Restoring original package.json files...');
    const restorePromises = packages.map(async (pkg) => {
      const originalPackageJson = originalPackageJsons.get(pkg.name);
      await writePackageJson(pkg.path, originalPackageJson);
    });

    await Promise.all(restorePromises);
  }

  if (publishSuccess) {
    console.log('\n🎉 All canary versions published successfully!');
  }
}

/**
 * Main publishing function
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

  console.log('🔍 Discovering workspace packages...');
  const packages = await getWorkspacePackages();

  if (packages.length === 0) {
    console.log('⚠️  No public packages found in workspace');
    return;
  }

  console.log(`📋 Found ${packages.length} public packages:`);
  packages.forEach((pkg) => {
    console.log(`   • ${pkg.name}@${pkg.version}`);
  });

  // Fetch version info for all packages in parallel
  console.log('\n🔍 Fetching package version information...');
  const versionInfoPromises = packages.map(async (pkg) => {
    const versionInfo = await getPackageVersionInfo(pkg.name, pkg.version);
    return { packageName: pkg.name, versionInfo };
  });

  const versionInfoResults = await Promise.all(versionInfoPromises);
  const packageVersionInfo = new Map();

  for (const { packageName, versionInfo } of versionInfoResults) {
    packageVersionInfo.set(packageName, versionInfo);
  }

  if (!canaryOnly) {
    await publishRegularVersions(packages, packageVersionInfo, options);
  }

  await publishCanaryVersions(packages, packageVersionInfo, options);

  console.log('\n🏁 Publishing complete!');
}

// Run the script
main();
