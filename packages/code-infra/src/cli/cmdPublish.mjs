#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * @typedef {import('./pnpm.mjs').Package} Package
 * @typedef {import('./pnpm.mjs').PublishOptions} PublishOptions
 */

import { Octokit } from '@octokit/rest';
import * as fs from 'fs/promises';
import * as semver from 'semver';
import gitUrlParse from 'git-url-parse';
import { $ } from 'execa';
import { getWorkspacePackages, publishPackages } from './pnpm.mjs';

/**
 * @typedef {Object} Args
 * @property {boolean} dry-run Run in dry-run mode without publishing
 * @property {boolean} no-git-checks - Skip git checks before publishing
 * @property {boolean} provenance - Enable provenance tracking for the publish
 */

/**
 * Get the version to release from the root package.json
 * @returns {Promise<string>} Version string
 */
async function getReleaseVersion() {
  const result = await $`pnpm pkg get version`;
  const versionData = JSON.parse(result.stdout.trim());
  const version = versionData.version;

  const validVersion = semver.valid(version);
  if (!validVersion) {
    throw new Error(`Invalid version in root package.json: ${version}`);
  }

  return validVersion;
}

/**
 * Parse changelog to extract content for a specific version
 * @param {string} changelogPath - Path to CHANGELOG.md
 * @param {string} version - Version to extract
 * @returns {Promise<string>} Changelog content for the version
 */
async function parseChangelog(changelogPath, version) {
  try {
    const content = await fs.readFile(changelogPath, 'utf8');
    const lines = content.split('\n');

    const versionHeader = `## ${version}`;
    const startIndex = lines.findIndex((line) => line.startsWith(versionHeader));

    if (startIndex === -1) {
      throw new Error(`Version ${version} not found in changelog`);
    }

    // Skip the version header and find content start
    let contentStartIndex = startIndex + 1;

    // Skip whitespace and comment lines
    while (contentStartIndex < lines.length) {
      const line = lines[contentStartIndex].trim();
      if (line === '' || line.startsWith('<!--')) {
        contentStartIndex += 1;
      } else {
        break;
      }
    }

    // Check if first content line is a date line
    if (contentStartIndex < lines.length) {
      const line = lines[contentStartIndex].trim();
      // Remove leading/trailing underscores if present
      const cleanLine = line.replace(/^_+|_+$/g, '');
      // Try to parse as date
      if (cleanLine && !Number.isNaN(Date.parse(cleanLine))) {
        contentStartIndex += 1; // Skip date line
      }
    }

    // Find the end of this version's content (next ## header)
    let endIndex = lines.length;
    for (let i = contentStartIndex; i < lines.length; i += 1) {
      if (lines[i].startsWith('## ')) {
        endIndex = i;
        break;
      }
    }

    return lines.slice(contentStartIndex, endIndex).join('\n').trim();
  } catch (/** @type {any} */ error) {
    if (error.code === 'ENOENT') {
      throw new Error('CHANGELOG.md not found');
    }
    throw error;
  }
}

/**
 * Check if GitHub release already exists
 * @param {Octokit} octokit - GitHub API client
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} version - Version to check
 * @returns {Promise<boolean>} True if release exists
 */
async function checkGitHubReleaseExists(octokit, owner, repo, version) {
  try {
    await octokit.repos.getReleaseByTag({ owner, repo, tag: `v${version}` });
    return true;
  } catch (/** @type {any} */ error) {
    if (error.status === 404) {
      return false;
    }
    throw error;
  }
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
 * Get current git SHA
 * @returns {Promise<string>} Current git commit SHA
 */
async function getCurrentGitSha() {
  const result = await $`git rev-parse HEAD`;
  return result.stdout.trim();
}

/**
 * Create and push a git tag
 * @param {string} version - Version to tag
 * @param {boolean} [dryRun=false] - Whether to run in dry-run mode
 * @returns {Promise<void>}
 */
async function createGitTag(version, dryRun = false) {
  const tagName = `v${version}`;

  try {
    await $`git tag ${tagName}`;
    const pushArgs = dryRun ? ['--dry-run'] : [];
    await $({ stdio: 'inherit' })`git push origin ${tagName} ${pushArgs}`;

    console.log(`🏷️  Created and pushed git tag ${tagName}${dryRun ? ' (dry-run)' : ''}`);
  } catch (/** @type {any} */ error) {
    throw new Error(`Failed to create git tag: ${error.message}`);
  }
}

/**
 * Validate GitHub release requirements
 * @param {string} version - Version to validate
 * @returns {Promise<{changelogContent: string, repoInfo: {owner: string, repo: string}}>}
 */
async function validateGitHubRelease(version) {
  console.log('🔍 Validating GitHub release requirements...');

  // Check if CHANGELOG.md exists and parse it
  console.log(`📄 Parsing CHANGELOG.md for version ${version}...`);
  const changelogContent = await parseChangelog('CHANGELOG.md', version);
  console.log('✅ Found changelog content for version');

  // Get repository info
  const repoInfo = await getRepositoryInfo();
  console.log(`📂 Repository: ${repoInfo.owner}/${repoInfo.repo}`);

  // Check if release already exists on GitHub
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });

  console.log(`🔍 Checking if GitHub release v${version} already exists...`);
  const releaseExists = await checkGitHubReleaseExists(
    octokit,
    repoInfo.owner,
    repoInfo.repo,
    version,
  );

  if (releaseExists) {
    throw new Error(`GitHub release v${version} already exists`);
  }
  console.log('✅ GitHub release does not exist yet');

  return { changelogContent, repoInfo };
}

/**
 * Publish packages to npm
 * @param {Package[]} packages - Packages to publish
 * @param {PublishOptions} options - Publishing options
 * @returns {Promise<void>}
 */
async function publishToNpm(packages, options) {
  console.log('\n📦 Publishing packages to npm...');
  console.log(`📋 Found ${packages.length} packages:`);
  packages.forEach((pkg) => {
    console.log(`   • ${pkg.name}@${pkg.version}`);
  });

  // Use pnpm's built-in duplicate checking - no need to check versions ourselves
  await publishPackages(packages, 'latest', options);
  console.log('✅ Successfully published to npm');
}

/**
 * Create GitHub release after npm publishing
 * @param {string} version - Version to release
 * @param {string} changelogContent - Changelog content
 * @param {{owner: string, repo: string}} repoInfo - Repository info
 * @returns {Promise<void>}
 */
async function createRelease(version, changelogContent, repoInfo) {
  console.log('\n🚀 Creating GitHub draft release...');

  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });

  const sha = await getCurrentGitSha();

  await octokit.repos.createRelease({
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    tag_name: `v${version}`,
    target_commitish: sha,
    name: `v${version}`,
    body: changelogContent,
    draft: true,
  });

  console.log(
    `✅ Created draft release v${version} at https://github.com/${repoInfo.owner}/${repoInfo.repo}/releases`,
  );
}

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'publish',
  describe: 'Publish packages to npm',
  builder: (yargs) => {
    return yargs
      .option('dry-run', {
        type: 'boolean',
        default: false,
        description: 'Run in dry-run mode without publishing',
      })
      .option('no-git-checks', {
        type: 'boolean',
        default: false,
        description: 'Skip git checks before publishing',
      })
      .option('provenance', {
        type: 'boolean',
        default: false,
        description: 'Enable provenance tracking for the publish',
      });
  },
  handler: async (argv) => {
    const { dryRun = false, provenance = false, githubRelease = false } = argv;

    const options = { dryRun, provenance };

    if (dryRun) {
      console.log('🧪 Running in DRY RUN mode - no actual publishing will occur\n');
    }

    if (provenance) {
      console.log('🔐 Provenance enabled - packages will include provenance information\n');
    }

    // Get all packages
    console.log('🔍 Discovering all workspace packages...');
    const allPackages = await getWorkspacePackages({ publicOnly: true });

    if (allPackages.length === 0) {
      console.log('⚠️  No public packages found in workspace');
      return;
    }

    // Get version from root package.json
    const version = await getReleaseVersion();
    console.log(`📋 Release version: ${version}`);

    // Early validation for GitHub release (before any publishing)
    let githubReleaseData = null;
    if (githubRelease) {
      githubReleaseData = await validateGitHubRelease(version);
    }

    // Publish to npm (pnpm handles duplicate checking automatically)
    await publishToNpm(allPackages, options);

    // Create GitHub release or git tag after successful npm publishing
    if (githubRelease && githubReleaseData && !dryRun) {
      await createRelease(version, githubReleaseData.changelogContent, githubReleaseData.repoInfo);
    } else if (githubRelease && dryRun) {
      console.log('\n🚀 Would create GitHub draft release (dry-run)');
    } else {
      // Create git tag when not doing GitHub release
      await createGitTag(version, dryRun);
    }

    console.log('\n🏁 Publishing complete!');
  },
});
