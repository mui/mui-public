#!/usr/bin/env node

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
      packageJson
    }));
  
  return publicPackages;
}

/**
 * Check if a specific version exists on npm registry
 */
async function checkNpmVersion(packageName, version) {
  try {
    const result = await $`npm view ${packageName}@${version} version`;
    return result.stdout.trim() === version;
  } catch (error) {
    return false; // Version doesn't exist
  }
}

/**
 * Get the latest canary version for a package
 */
async function getLatestCanaryVersion(packageName, baseVersion) {
  try {
    const result = await $`npm view ${packageName} versions --json`;
    const versions = JSON.parse(result.stdout);
    
    const canaryVersions = versions
      .filter(v => v.startsWith(`${baseVersion}-canary.`))
      .map(v => {
        const match = v.match(/canary\.(\d+)$/);
        return { version: v, number: match ? parseInt(match[1], 10) : 0 };
      })
      .sort((a, b) => b.number - a.number);
    
    return canaryVersions[0]?.version || null;
  } catch (error) {
    return null;
  }
}

/**
 * Get the next canary number
 */
function getNextCanaryNumber(latestCanaryVersion) {
  if (!latestCanaryVersion) return 0;
  
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
  const content = JSON.stringify(packageJson, null, 2) + '\n';
  await fs.writeFile(path.join(packagePath, 'package.json'), content);
}

/**
 * Update dependencies to point to canary versions
 */
function updateDependenciesToCanary(dependencies, canaryVersions) {
  if (!dependencies) return dependencies;
  
  const updated = { ...dependencies };
  
  for (const [depName, depVersion] of Object.entries(dependencies)) {
    if (canaryVersions.has(depName)) {
      updated[depName] = canaryVersions.get(depName);
    } else if (depVersion === 'workspace:*') {
      // Check if this is a workspace dependency that has a canary version
      const workspacePackageName = Object.keys(Object.fromEntries(canaryVersions))
        .find(name => name.includes(depName) || depName.includes(name));
      
      if (workspacePackageName && canaryVersions.has(workspacePackageName)) {
        updated[depName] = canaryVersions.get(workspacePackageName);
      }
    }
  }
  
  return updated;
}

/**
 * Publish a package
 */
async function publishPackage(packagePath, tag, dryRun = false) {
  if (dryRun) {
    console.log(`[DRY RUN] Would execute: pnpm publish --tag ${tag} in ${packagePath}`);
    return;
  }
  
  await $({ cwd: packagePath })`pnpm publish --tag ${tag}`;
}

/**
 * Publish regular versions that don't exist on npm
 */
async function publishRegularVersions(packages, dryRun = false) {
  console.log('\n📦 Checking for unpublished regular versions...');
  
  for (const pkg of packages) {
    const versionExists = await checkNpmVersion(pkg.name, pkg.version);
    
    if (!versionExists) {
      console.log(`📤 Publishing ${pkg.name}@${pkg.version}...`);
      await publishPackage(pkg.path, 'latest', dryRun);
      console.log(`✅ Published ${pkg.name}@${pkg.version}`);
    } else {
      console.log(`⏭️  ${pkg.name}@${pkg.version} already exists, skipping`);
    }
  }
}

/**
 * Publish canary versions with updated dependencies
 */
async function publishCanaryVersions(packages, dryRun = false) {
  console.log('\n🔥 Publishing canary versions...');
  
  const gitSha = await getCurrentGitSha();
  const canaryVersions = new Map();
  const originalPackageJsons = new Map();
  
  // First pass: determine all canary version numbers
  for (const pkg of packages) {
    const latestCanary = await getLatestCanaryVersion(pkg.name, pkg.version);
    const nextCanaryNumber = getNextCanaryNumber(latestCanary);
    const canaryVersion = `${pkg.version}-canary.${nextCanaryNumber}`;
    
    canaryVersions.set(pkg.name, canaryVersion);
    console.log(`🏷️  ${pkg.name}: ${canaryVersion}`);
  }
  
  // Second pass: update package.json files with canary versions and dependencies
  for (const pkg of packages) {
    const originalPackageJson = await readPackageJson(pkg.path);
    originalPackageJsons.set(pkg.name, originalPackageJson);
    
    const canaryVersion = canaryVersions.get(pkg.name);
    const updatedPackageJson = {
      ...originalPackageJson,
      version: canaryVersion,
      gitSha: gitSha
    };
    
    // Update dependencies to point to canary versions
    if (updatedPackageJson.dependencies) {
      updatedPackageJson.dependencies = updateDependenciesToCanary(
        originalPackageJson.dependencies,
        canaryVersions
      );
    }
    
    if (updatedPackageJson.devDependencies) {
      updatedPackageJson.devDependencies = updateDependenciesToCanary(
        originalPackageJson.devDependencies,
        canaryVersions
      );
    }
    
    if (updatedPackageJson.peerDependencies) {
      updatedPackageJson.peerDependencies = updateDependenciesToCanary(
        originalPackageJson.peerDependencies,
        canaryVersions
      );
    }
    
    if (!dryRun) {
      await writePackageJson(pkg.path, updatedPackageJson);
    }
    
    console.log(`📝 Updated ${pkg.name} package.json for canary release`);
  }
  
  // Third pass: publish all canary versions
  let publishSuccess = false;
  try {
    for (const pkg of packages) {
      const canaryVersion = canaryVersions.get(pkg.name);
      console.log(`📤 Publishing ${pkg.name}@${canaryVersion} with canary tag...`);
      await publishPackage(pkg.path, 'canary', dryRun);
      console.log(`✅ Published ${pkg.name}@${canaryVersion}`);
    }
    publishSuccess = true;
  } finally {
    // Always restore original package.json files
    if (!dryRun) {
      console.log('\n🔄 Restoring original package.json files...');
      for (const pkg of packages) {
        const originalPackageJson = originalPackageJsons.get(pkg.name);
        await writePackageJson(pkg.path, originalPackageJson);
        console.log(`✅ Restored ${pkg.name}/package.json`);
      }
    }
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
  
  if (dryRun) {
    console.log('🧪 Running in DRY RUN mode - no actual publishing will occur\n');
  }
  
  console.log('🔍 Discovering workspace packages...');
  const packages = await getWorkspacePackages();
  
  if (packages.length === 0) {
    console.log('⚠️  No public packages found in workspace');
    return;
  }
  
  console.log(`📋 Found ${packages.length} public packages:`);
  packages.forEach(pkg => {
    console.log(`   • ${pkg.name}@${pkg.version}`);
  });
  
  if (!canaryOnly) {
    await publishRegularVersions(packages, dryRun);
  }
  
  await publishCanaryVersions(packages, dryRun);
  
  console.log('\n🏁 Publishing complete!');
}

// Run the script
main();