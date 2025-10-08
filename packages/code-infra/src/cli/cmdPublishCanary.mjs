#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * @typedef {import('../utils/pnpm.mjs').PublicPackage} PublicPackage
 * @typedef {import('../utils/pnpm.mjs').VersionInfo} VersionInfo
 * @typedef {import('../utils/pnpm.mjs').PublishOptions} PublishOptions
 */

import { Octokit } from '@octokit/rest';
import { createActionAuth } from '@octokit/auth-action';
import { $ } from 'execa';
import gitUrlParse from 'git-url-parse';
import * as semver from 'semver';

/**
 * @typedef {Object} Args
 * @property {boolean} [dryRun] - Whether to run in dry-run mode
 * @property {boolean} [githubRelease] - Whether to create GitHub releases for canary packages
 */

import {
  getWorkspacePackages,
  getPackageVersionInfo,
  publishPackages,
  readPackageJson,
  writePackageJson,
  getCurrentGitSha,
  semverMax,
} from '../utils/pnpm.mjs';

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
 * @param {string} npmPackageName - npm package name (e.g., '@mui/internal-code-infra')
 * @returns {string} Package name for label (e.g., 'code-infra')
 */
function extractPackageNameForLabel(npmPackageName) {
  // For scoped packages like @mui/internal-code-infra, extract the last part after 'internal-'
  if (npmPackageName.startsWith('@')) {
    const parts = npmPackageName.split('/');
    if (parts.length >= 2) {
      const packageName = parts[1];
      // Remove 'internal-' prefix if present
      return packageName.replace(/^internal-/, '');
    }
  }
  return npmPackageName;
}

/**
 * Get merged PRs since the last canary tag
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string|null} sinceTag - Git tag to get PRs since
 * @returns {Promise<Array<{number: number, title: string, labels: string[], html_url: string, merged_at: string}>>} List of merged PRs
 */
async function getMergedPRsSinceTag(owner, repo, sinceTag) {
  const octokit = getOctokit();

  // Get the commit SHA of the tag if it exists
  let sinceDate = null;
  if (sinceTag) {
    try {
      const { data: refData } = await octokit.git.getRef({
        owner,
        repo,
        ref: `tags/${sinceTag}`,
      });
      const tagSha = refData.object.sha;

      // Get the commit date
      const { data: commitData } = await octokit.git.getCommit({
        owner,
        repo,
        commit_sha: tagSha,
      });
      sinceDate = commitData.committer.date;
    } catch (error) {
      console.log(`⚠️  Could not find tag ${sinceTag}, will fetch all recent PRs`);
    }
  }

  // Fetch merged PRs
  const prs = [];
  let page = 1;
  const perPage = 100;
  let hasMore = true;

  while (hasMore) {
    // eslint-disable-next-line no-await-in-loop
    const { data } = await octokit.pulls.list({
      owner,
      repo,
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
      per_page: perPage,
      page,
    });

    if (data.length === 0) {
      break;
    }

    for (const pr of data) {
      // Only include merged PRs
      if (!pr.merged_at) {
        continue;
      }

      // If we have a sinceDate, only include PRs merged after that date
      if (sinceDate && new Date(pr.merged_at) <= new Date(sinceDate)) {
        // Since PRs are sorted by updated date, we can stop here
        return prs;
      }

      const labels = pr.labels.map((label) => (typeof label === 'string' ? label : label.name));

      // Skip PRs that have only one label and that label is 'dependency'
      if (labels.length === 1 && labels[0].toLowerCase() === 'dependency') {
        continue;
      }

      prs.push({
        number: pr.number,
        title: pr.title,
        labels,
        html_url: pr.html_url,
        merged_at: pr.merged_at,
      });
    }

    // If we got fewer results than requested, we've reached the end
    if (data.length < perPage) {
      hasMore = false;
    }

    page += 1;

    // Safety limit to avoid infinite loops
    if (page > 10) {
      console.log('⚠️  Reached page limit (10) when fetching PRs');
      break;
    }
  }

  return prs;
}

/**
 * Generate changelog for a package based on PRs
 * @param {string} packageName - Package name (e.g., 'code-infra')
 * @param {Array<{number: number, title: string, labels: string[], html_url: string}>} allPRs - All merged PRs
 * @returns {string} Generated changelog content
 */
function generateChangelogForPackage(packageName, allPRs) {
  const scopeLabel = `scope: ${packageName}`;

  // Filter PRs that have the matching scope label
  const relevantPRs = allPRs.filter((pr) =>
    pr.labels.some((label) => label.toLowerCase() === scopeLabel.toLowerCase()),
  );

  if (relevantPRs.length === 0) {
    return 'No changes with scope labels found for this package.';
  }

  // Generate changelog content
  const changelogLines = relevantPRs.map((pr) => `- ${pr.title} (#${pr.number})`);

  return changelogLines.join('\n');
}

/**
 * Prepare changelog data for packages
 * @param {PublicPackage[]} packagesToPublish - Packages that will be published
 * @param {Map<string, string>} canaryVersions - Map of package names to their canary versions
 * @param {string|null} sinceTag - Git tag to get PRs since
 * @returns {Promise<Map<string, string>>} Map of package names to their changelogs
 */
async function prepareChangelogsForPackages(packagesToPublish, canaryVersions, sinceTag) {
  console.log('\n📝 Preparing changelogs for packages...');

  const repoInfo = await getRepositoryInfo();
  console.log(`📂 Repository: ${repoInfo.owner}/${repoInfo.repo}`);

  // Fetch merged PRs since the last canary tag
  console.log('🔍 Fetching merged PRs...');
  const allPRs = await getMergedPRsSinceTag(repoInfo.owner, repoInfo.repo, sinceTag);
  console.log(`📋 Found ${allPRs.length} merged PRs since last canary tag`);

  const changelogs = new Map();

  for (const pkg of packagesToPublish) {
    const version = canaryVersions.get(pkg.name);
    if (!version) {
      console.log(`⚠️  No version found for ${pkg.name}, skipping...`);
      continue;
    }

    const packageLabel = extractPackageNameForLabel(pkg.name);
    const changelog = generateChangelogForPackage(packageLabel, allPRs);
    changelogs.set(pkg.name, changelog);

    console.log(`📦 ${pkg.name}@${version}`);
    console.log(
      `   Changelog:\n${changelog
        .split('\n')
        .map((line) => `   ${line}`)
        .join('\n')}`,
    );
  }

  console.log('\n✅ Changelogs prepared successfully');
  return changelogs;
}

/**
 * Create GitHub releases and tags for published packages
 * @param {PublicPackage[]} publishedPackages - Packages that were published
 * @param {Map<string, string>} canaryVersions - Map of package names to their canary versions
 * @param {Map<string, string>} changelogs - Map of package names to their changelogs
 * @param {boolean} dryRun - Whether to run in dry-run mode
 * @returns {Promise<void>}
 */
async function createGitHubReleasesForPackages(
  publishedPackages,
  canaryVersions,
  changelogs,
  dryRun,
) {
  console.log('\n🚀 Creating GitHub releases and tags for published packages...');

  if (dryRun) {
    console.log('🧪 Dry-run mode: Would create releases and tags for:');
    for (const pkg of publishedPackages) {
      const version = canaryVersions.get(pkg.name);
      if (!version) {
        continue;
      }
      const tagName = `${pkg.name}@${version}`;
      console.log(`   • ${tagName}`);
    }
    return;
  }

  const repoInfo = await getRepositoryInfo();
  const gitSha = await getCurrentGitSha();
  const octokit = getOctokit();

  for (const pkg of publishedPackages) {
    const version = canaryVersions.get(pkg.name);
    if (!version) {
      console.log(`⚠️  No version found for ${pkg.name}, skipping...`);
      continue;
    }

    const changelog = changelogs.get(pkg.name) || 'No changelog available';
    const tagName = `${pkg.name}@${version}`;
    const releaseName = tagName;

    console.log(`\n📦 Processing ${pkg.name}@${version}...`);

    try {
      // Create git tag
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
      await octokit.repos.createRelease({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        tag_name: tagName,
        target_commitish: gitSha,
        name: releaseName,
        body: changelog,
        draft: false,
        prerelease: true, // Mark as prerelease since these are canary versions
      });

      console.log(`✅ Created GitHub release: ${releaseName}`);
    } catch (/** @type {any} */ error) {
      console.error(`❌ Failed to create release for ${pkg.name}: ${error.message}`);
      // Continue with other packages even if one fails
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
 * Publish canary versions with updated dependencies
 * @param {PublicPackage[]} packagesToPublish - Packages that need canary publishing
 * @param {PublicPackage[]} allPackages - All workspace packages
 * @param {Map<string, VersionInfo>} packageVersionInfo - Version info map
 * @param {PublishOptions} [options={}] - Publishing options
 * @param {boolean} [githubRelease=false] - Whether to create GitHub releases
 * @param {string|null} [sinceTag=null] - Git tag to get PRs since
 * @returns {Promise<void>}
 */
async function publishCanaryVersions(
  packagesToPublish,
  allPackages,
  packageVersionInfo,
  options = {},
  githubRelease = false,
  sinceTag = null,
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

  // Prepare changelogs before building and publishing (so it can error out early if there are issues)
  let changelogs = new Map();
  if (githubRelease) {
    changelogs = await prepareChangelogsForPackages(packagesToPublish, canaryVersions, sinceTag);
  }

  // Run release build after updating package.json files
  console.log('\n🔨 Running release build...');
  await $({ stdio: 'inherit' })`pnpm release:build`;
  console.log('✅ Release build completed successfully');

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
    const restorePromises = allPackages.map(async (pkg) => {
      const originalPackageJson = originalPackageJsons.get(pkg.name);
      await writePackageJson(pkg.path, originalPackageJson);
    });

    await Promise.all(restorePromises);
  }

  if (publishSuccess) {
    // Create/update the canary tag after successful publish
    await createCanaryTag(options.dryRun);

    // Create GitHub releases if requested
    if (githubRelease) {
      await createGitHubReleasesForPackages(
        packagesToPublish,
        canaryVersions,
        changelogs,
        options.dryRun || false,
      );
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

    const options = { dryRun };

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

    console.log(
      canaryTag
        ? '🔍 Checking for packages changed since canary tag...'
        : '🔍 No canary tag found, will publish all packages',
    );
    const packages = canaryTag
      ? await getWorkspacePackages({ sinceRef: canaryTag, publicOnly: true })
      : allPackages;

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

    await publishCanaryVersions(
      packages,
      allPackages,
      packageVersionInfo,
      options,
      githubRelease,
      canaryTag,
    );

    console.log('\n🏁 Publishing complete!');
  },
});
