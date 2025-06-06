#!/usr/bin/env node

/* eslint-disable no-console */

import { $ } from 'execa';
import fs from 'fs/promises';
import path from 'path';

/**
 * Wrapper for $ that supports dry run mode
 */
function runCmd(options = {}) {
  const { dryRun = false, ...execaOptions } = options;

  if (dryRun) {
    return function dryRunExec(templateStrings, ...values) {
      // Reconstruct the command string
      let command = templateStrings[0];
      for (let i = 0; i < values.length; i += 1) {
        command += String(values[i]) + templateStrings[i + 1];
      }
      console.log(`[DRY RUN] Would execute: ${command}`);
      return Promise.resolve({ stdout: '', stderr: '' });
    };
  }

  return $(execaOptions);
}

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
    const result = await $`pnpm view ${packageName} versions --json`;
    const versions = JSON.parse(result.stdout);

    // Check if current version exists
    const currentVersionExists = versions.includes(baseVersion);

    // Find latest canary version
    const canaryVersions = versions
      .filter((v) => v.startsWith(`${baseVersion}-canary.`))
      .map((v) => {
        const match = v.match(/canary\.(\d+)$/);
        return { version: v, number: match ? parseInt(match[1], 10) : 0 };
      })
      .sort((a, b) => b.number - a.number);

    const latestCanaryVersion = canaryVersions[0]?.version || null;

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
 * Update dependencies to point to canary versions
 */
function updateDependenciesToCanary(dependencies, canaryVersions) {
  if (!dependencies) {
    return dependencies;
  }

  const updated = { ...dependencies };

  for (const [depName, depVersion] of Object.entries(dependencies)) {
    if (canaryVersions.has(depName)) {
      updated[depName] = canaryVersions.get(depName);
    } else if (depVersion === 'workspace:*') {
      if (!canaryVersions.has(depName)) {
        throw new Error(
          `Cannot resolve workspace dependency "${depName}" - no canary version available`,
        );
      }
      updated[depName] = canaryVersions.get(depName);
    }
  }

  return updated;
}

/**
 * Publish a package
 */
async function publishPackage(packagePath, tag, options = {}) {
  const { provenance = false, dryRun = false } = options;
  const provenanceArgs = provenance ? ['--provenance'] : [];
  const gitChecksArgs = tag === 'canary' ? ['--no-git-checks'] : [];

  await runCmd({ cwd: packagePath, dryRun })`pnpm publish --tag ${tag} ${provenanceArgs} ${gitChecksArgs}`;
}

/**
 * Publish regular versions that don't exist on npm
 */
async function publishRegularVersions(packages, packageVersionInfo, options = {}) {
  console.log('\n📦 Checking for unpublished regular versions...');

  // run sequentially to avoid any rate limniting issues
  for (const pkg of packages) {
    const { currentVersionExists } = packageVersionInfo.get(pkg.name);

    if (!currentVersionExists) {
      console.log(`📤 Publishing ${pkg.name}@${pkg.version}...`);
      // eslint-disable-next-line no-await-in-loop
      await publishPackage(pkg.path, 'latest', options);
      console.log(`✅ Published ${pkg.name}@${pkg.version}`);
    } else {
      console.log(`⏭️  ${pkg.name}@${pkg.version} already exists, skipping`);
    }
  }
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

    // Update dependencies to point to canary versions
    if (updatedPackageJson.dependencies) {
      updatedPackageJson.dependencies = updateDependenciesToCanary(
        originalPackageJson.dependencies,
        canaryVersions,
      );
    }

    if (updatedPackageJson.devDependencies) {
      updatedPackageJson.devDependencies = updateDependenciesToCanary(
        originalPackageJson.devDependencies,
        canaryVersions,
      );
    }

    if (updatedPackageJson.peerDependencies) {
      updatedPackageJson.peerDependencies = updateDependenciesToCanary(
        originalPackageJson.peerDependencies,
        canaryVersions,
      );
    }

    await writePackageJson(pkg.path, updatedPackageJson);

    console.log(`📝 Updated ${pkg.name} package.json for canary release`);
    return { pkg, originalPackageJson };
  });

  const updateResults = await Promise.all(packageUpdatePromises);

  // Build the original package.json map
  for (const { pkg, originalPackageJson } of updateResults) {
    originalPackageJsons.set(pkg.name, originalPackageJson);
  }

  // Third pass: publish all canary versions sequentially to avoid rate limits
  let publishSuccess = false;
  try {
    for (const pkg of packages) {
      const canaryVersion = canaryVersions.get(pkg.name);
      console.log(`📤 Publishing ${pkg.name}@${canaryVersion} with canary tag...`);
      // eslint-disable-next-line no-await-in-loop
      await publishPackage(pkg.path, 'canary', options);
      console.log(`✅ Published ${pkg.name}@${canaryVersion}`);
    }
    publishSuccess = true;
  } finally {
    // Always restore original package.json files in parallel
    console.log('\n🔄 Restoring original package.json files...');
    const restorePromises = packages.map(async (pkg) => {
      const originalPackageJson = originalPackageJsons.get(pkg.name);
      await writePackageJson(pkg.path, originalPackageJson);
      console.log(`✅ Restored ${pkg.name}/package.json`);
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
