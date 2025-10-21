#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * @typedef {import('../utils/pnpm.mjs').PublicPackage} PublicPackage
 * @typedef {import('../utils/pnpm.mjs').VersionInfo} VersionInfo
 * @typedef {import('../utils/pnpm.mjs').PublishOptions} PublishOptions
 */

import path from 'node:path';
import { createActionAuth } from '@octokit/auth-action';
import { Octokit } from '@octokit/rest';
import { $ } from 'execa';
import gitUrlParse from 'git-url-parse';
import * as semver from 'semver';

import {
  getCurrentGitSha,
  getPackageVersionInfo,
  getWorkspacePackages,
  publishPackages,
  readPackageJson,
  semverMax,
  writePackageJson,
} from '../utils/pnpm.mjs';

/**
 * @typedef {Object} Args
 * @property {boolean} [dryRun] - Whether to run in dry-run mode
 * @property {boolean} [githubRelease] - Whether to create GitHub releases for canary packages
 */

const CANARY_TAG = 'canary';

/**
 * Get Octokit instance with authentication
 * @returns {Octokit} Authenticated Octokit instance
 */
function getOctokit() {
  return new Octokit({ authStrategy: createActionAuth });
}

/**
 * Get current repository info from git remote
 * @returns {Promise<{owner: string, repo: string}>} Repository owner and name
 */
async function getRepositoryInfo() {
  try {
    const result = await $`git remote get-url origin`;
    const url = result.stdout.trim();

    const parsed = gitUrlParse(url);
    if (parsed.source !== 'github.com') {
      throw new Error('Repository is not hosted on GitHub');
    }

    return {
      owner: parsed.owner,
      repo: parsed.name,
    };
  } catch (/** @type {any} */ error) {
    throw new Error(`Failed to get repository info: ${error.message}`);
  }
}

/**
 * Extract package name from npm package name for label matching
 * @param {string} commitHash - Commit hash to check changed files
 * @param {PublicPackage[]} allPackages - List of all package names
 * @returns {Promise<string[]>} Affected package names
 */
async function getAffectedPkgsForCommit(commitHash, allPackages) {
  const { stdout } = await $`git diff-tree --no-commit-id --name-only -r ${commitHash}`;
  const affectedFiles = stdout.trim().split('\n');
  /**
   * @type {Set<string>}
   */
  const affectedPackages = new Set();

  for (const filePath of affectedFiles) {
    for (const pkg of allPackages) {
      const relativePath = path.relative(pkg.path, filePath);
      if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
        affectedPackages.add(pkg.name);
      }
    }
  }

  return Array.from(affectedPackages);
}

/**
 *
 * @param {Object} param0
 * @param {string} param0.repo
 * @param {string} param0.owner
 * @returns {Promise<Awaited<ReturnType<Octokit['repos']['compareCommits']>>['data']['commits']>}
 */
async function fetchCommitsBetweenRefs({ repo, owner }) {
  const octokit = getOctokit();
  /**
   * @typedef {Awaited<ReturnType<Octokit['repos']['compareCommits']>>['data']['commits']} Commits
   */
  /**
   * @type {Commits}
   */
  const results = [];
  /**
   * @type {any}
   */
  const timeline = octokit.paginate.iterator(
    octokit.repos.compareCommitsWithBasehead.endpoint.merge({
      owner,
      repo,
      basehead: `${CANARY_TAG}...master`,
    }),
  );
  for await (const response of timeline) {
    results.push(...response.data.commits);
  }
  return results;
}

/**
 * Prepare changelog data for packages using GitHub API
 * @param {PublicPackage[]} packagesToPublish - Packages that will be published
 * @param {Map<string, string>} canaryVersions - Map of package names to their canary versions
 * @param {{owner: string, repo: string}} repoInfo - Repository information
 * @returns {Promise<Map<string, string[]>>} Map of package names to their changelogs
 */
async function prepareChangelogsFromGitHub(packagesToPublish, canaryVersions, repoInfo) {
  console.log('🔍 Fetching merged commits from GitHub API...');
  const commits = await fetchCommitsBetweenRefs(repoInfo);
  console.log(`📋 Found ${commits.length} merged commits since last canary tag`);

  /**
   * @type {Map<string, string[]>}
   */
  const changelogs = new Map();
  for (const commit of commits) {
    // eslint-disable-next-line no-await-in-loop
    const affectedPackages = await getAffectedPkgsForCommit(commit.sha, packagesToPublish);
    for (const pkgName of affectedPackages) {
      const existingChangelogs = changelogs.get(pkgName) || [];
      existingChangelogs.push(
        `- ${commit.commit.message.split('\n')[0]} (${commit.sha.slice(0, 7)})`,
      );
      changelogs.set(pkgName, existingChangelogs);
    }
  }
  return changelogs;
}

/**
 * Prepare changelog data for packages
 * @param {PublicPackage[]} packagesToPublish - Packages that will be published
 * @param {Map<string, string>} canaryVersions - Map of package names to their canary versions
 * @returns {Promise<Map<string, string[]>>} Map of package names to their changelogs
 */
async function prepareChangelogsForPackages(packagesToPublish, canaryVersions) {
  console.log('\n📝 Preparing changelogs for packages...');

  const repoInfo = await getRepositoryInfo();
  console.log(`📂 Repository: ${repoInfo.owner}/${repoInfo.repo}`);

  /**
   * @type {Map<string, string[]>}
   */
  let changelogs = new Map();

  changelogs = await prepareChangelogsFromGitHub(packagesToPublish, canaryVersions, repoInfo);

  // Log changelog content for each package
  for (const pkg of packagesToPublish) {
    const version = canaryVersions.get(pkg.name);
    if (!version) {
      continue;
    }

    const changelog = changelogs.get(pkg.name) || [];
    console.log(`\n📦 ${pkg.name}@${version}`);
    if (changelog) {
      console.log(
        `   Changelog:\n${changelog.map((/** @type {string} */ line) => `   ${line}`).join('\n')}`,
      );
    } else {
      console.log('   Changelog: No changes with scope labels found for this package.');
    }
  }

  console.log('\n✅ Changelogs prepared successfully');
  return changelogs;
}

/**
 * Create GitHub releases and tags for published packages
 * @param {PublicPackage[]} publishedPackages - Packages that were published
 * @param {Map<string, string>} canaryVersions - Map of package names to their canary versions
 * @param {Map<string, string[]>} changelogs - Map of package names to their changelogs
 * @param {{dryRun?: boolean}} options - Publishing options
 * @returns {Promise<void>}
 */
async function createGitHubReleasesForPackages(
  publishedPackages,
  canaryVersions,
  changelogs,
  options,
) {
  console.log('\n🚀 Creating GitHub releases and tags for published packages...');

  const repoInfo = await getRepositoryInfo();
  const gitSha = await getCurrentGitSha();
  const octokit = getOctokit();

  for (const pkg of publishedPackages) {
    const version = canaryVersions.get(pkg.name);
    if (!version) {
      console.log(`⚠️  No version found for ${pkg.name}, skipping...`);
      continue;
    }

    const changelog = changelogs.get(pkg.name);
    if (!changelog) {
      console.log(`⚠️  No changelog found for ${pkg.name}, skipping release creation...`);
      continue;
    }
    const tagName = `${pkg.name}@${version}`;
    const releaseName = tagName;

    console.log(`\n📦 Processing ${pkg.name}@${version}...`);

    // Create git tag
    if (options.dryRun) {
      console.log(`🏷️  Would create and push git tag: ${tagName} (dry-run)`);
      console.log(`📝  Would publish a Github release:`);
      console.log(`     - Name: ${releaseName}`);
      console.log(`     - Tag: ${tagName}`);
      console.log(`     - Body:\n${changelog.join('\n')}`);
    } else {
      // eslint-disable-next-line no-await-in-loop
      await $({
        env: {
          ...process.env,
          GIT_COMMITTER_NAME: 'Code infra',
          GIT_COMMITTER_EMAIL: 'code-infra@mui.com',
        },
      })`git tag -a ${tagName} -m ${`Canary release ${pkg.name}@${version}`}`;

      // eslint-disable-next-line no-await-in-loop
      await $`git push origin ${tagName}`;
      console.log(`✅ Created and pushed git tag: ${tagName}`);

      // Create GitHub release
      // eslint-disable-next-line no-await-in-loop
      const res = await octokit.repos.createRelease({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        tag_name: tagName,
        target_commitish: gitSha,
        name: releaseName,
        body: changelog.join('\n'),
        draft: false,
        prerelease: true, // Mark as prerelease since these are canary versions
      });

      console.log(`✅ Created GitHub release: ${releaseName} at ${res.data.html_url}`);
    }
  }

  console.log('\n✅ Finished creating GitHub releases');
}

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
 * Publish canary versions with updated dependencies. A big assumption here is that
 * all packages are already built before calling this function.
 *
 * @param {PublicPackage[]} packagesToPublish - Packages that need canary publishing
 * @param {PublicPackage[]} allPackages - All workspace packages
 * @param {Map<string, VersionInfo>} packageVersionInfo - Version info map
 * @param {PublishOptions & {githubRelease?: boolean}} [options={}] - Publishing options
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
  // Packages are already built at this point.
  const packageUpdatePromises = allPackages.map(async (pkg) => {
    let originalPackageJson = await readPackageJson(pkg.path);
    let pkgJsonDirectory = pkg.path;
    if (originalPackageJson.publishConfig?.directory) {
      pkgJsonDirectory = path.join(pkg.path, originalPackageJson.publishConfig.directory);
      originalPackageJson = await readPackageJson(pkgJsonDirectory);
    }

    const canaryVersion = canaryVersions.get(pkg.name);
    if (canaryVersion) {
      const updatedPackageJson = {
        ...originalPackageJson,
        version: canaryVersion,
        gitSha,
      };
      await writePackageJson(pkgJsonDirectory, updatedPackageJson);
      console.log(`📝 Updated ${pkg.name} package.json to ${canaryVersion}`);
    }
    return { pkg, originalPackageJson, pkgJsonDirectory };
  });

  const updateResults = await Promise.all(packageUpdatePromises);

  // Prepare changelogs before building and publishing (so it can error out early if there are issues)
  /**
   * @type {Map<string, string[]>}
   */
  let changelogs = new Map();
  if (options.githubRelease) {
    changelogs = await prepareChangelogsForPackages(packagesToPublish, canaryVersions);
  }

  // Third pass: publish only the changed packages using recursive publish
  let publishSuccess = false;
  try {
    console.log(`📤 Publishing ${packagesToPublish.length} canary versions...`);
    await publishPackages(packagesToPublish, { ...options, noGitChecks: true, tag: 'canary' });

    packagesToPublish.forEach((pkg) => {
      const canaryVersion = canaryVersions.get(pkg.name);
      console.log(`✅ Published ${pkg.name}@${canaryVersion}`);
    });
    publishSuccess = true;
  } finally {
    // Always restore original package.json files in parallel
    console.log('\n🔄 Restoring original package.json files...');
    const restorePromises = updateResults.map(
      async ({ pkg, originalPackageJson, pkgJsonDirectory }) => {
        // no need to restore package.json files in build directories
        if (pkgJsonDirectory === pkg.path) {
          await writePackageJson(pkg.path, originalPackageJson);
        }
      },
    );

    await Promise.all(restorePromises);
  }

  if (publishSuccess) {
    // Create/update the canary tag after successful publish
    await createCanaryTag(options.dryRun);

    // Create GitHub releases if requested
    if (options.githubRelease) {
      await createGitHubReleasesForPackages(packagesToPublish, canaryVersions, changelogs, options);
    }

    console.log('\n🎉 All canary versions published successfully!');
  }
}

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'publish-canary',
  describe: 'Publish canary packages to npm',
  builder: (yargs) => {
    return yargs
      .option('dry-run', {
        type: 'boolean',
        default: false,
        description: 'Run in dry-run mode without publishing',
      })
      .option('github-release', {
        type: 'boolean',
        default: false,
        description: 'Create GitHub releases for published packages',
      });
  },
  handler: async (argv) => {
    const { dryRun = false, githubRelease = false } = argv;

    const options = { dryRun, githubRelease };

    if (dryRun) {
      console.log('🧪 Running in DRY RUN mode - no actual publishing will occur\n');
    }

    if (githubRelease) {
      console.log('📝 GitHub releases will be created for published packages\n');
    }

    // Always get all packages first
    console.log('🔍 Discovering all workspace packages...');
    const allPackages = await getWorkspacePackages({ publicOnly: true });

    if (allPackages.length === 0) {
      console.log('⚠️  No public packages found in workspace');
      return;
    }

    // Check for canary tag to determine selective publishing
    const canaryTag = await getLastCanaryTag();

    console.log('🔍 Checking for packages changed since canary tag...');
    const packages = canaryTag
      ? await getWorkspacePackages({ sinceRef: canaryTag, publicOnly: true })
      : allPackages;

    console.log(`📋 Found ${packages.length} packages(s) for canary publishing:`);
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
  },
});
