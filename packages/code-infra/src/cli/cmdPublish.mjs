#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * @typedef {import('./pnpm.mjs').PublicPackage} PublicPackage
 * @typedef {import('./pnpm.mjs').PublishOptions} PublishOptions
 */

import { Octokit } from '@octokit/rest';
import * as fs from 'node:fs/promises';
import * as semver from 'semver';
import gitUrlParse from 'git-url-parse';
import { $ } from 'execa';
import { createActionAuth } from '@octokit/auth-action';
import { getWorkspacePackages, publishPackages } from './pnpm.mjs';

function getOctokit() {
  return new Octokit({ authStrategy: createActionAuth });
}

/**
 * @typedef {Object} Args
 * @property {boolean} dry-run Run in dry-run mode without publishing
 * @property {boolean} github-release Create a GitHub draft release after publishing
 */

/**
 * Get the version to release from the root package.json
 * @returns {Promise<string | null>} Version string
 */
async function getReleaseVersion() {
  const result = await $`pnpm pkg get version`;
  const version = JSON.parse(result.stdout.trim());
  return semver.valid(version);
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
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} version - Version to check
 * @returns {Promise<boolean>} True if release exists
 */
async function checkGitHubReleaseExists(owner, repo, version) {
  try {
    const octokit = getOctokit();
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
    await $`git tag -a ${tagName} -m "Version ${version}"`;
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
 * @returns {Promise<{changelogContent: string, version: string, repoInfo: {owner: string, repo: string}}>}
 */
async function validateGitHubRelease(version) {
  console.log('🔍 Validating GitHub release requirements...');

  const validVersion = semver.valid(version);
  if (!validVersion) {
    throw new Error(`Invalid version in root package.json: ${version}`);
  }

  // Check if CHANGELOG.md exists and parse it
  console.log(`📄 Parsing CHANGELOG.md for version ${validVersion}...`);
  const changelogContent = await parseChangelog('CHANGELOG.md', validVersion);
  console.log('✅ Found changelog content for version');

  // Get repository info
  const repoInfo = await getRepositoryInfo();
  console.log(`📂 Repository: ${repoInfo.owner}/${repoInfo.repo}`);

  console.log(`🔍 Checking if GitHub release v${validVersion} already exists...`);
  const releaseExists = await checkGitHubReleaseExists(repoInfo.owner, repoInfo.repo, validVersion);

  if (releaseExists) {
    throw new Error(`GitHub release v${validVersion} already exists`);
  }
  console.log('✅ GitHub release does not exist yet');

  return { changelogContent, repoInfo, version: validVersion };
}

/**
 * Publish packages to npm
 * @param {PublicPackage[]} packages - Packages to publish
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

  const sha = await getCurrentGitSha();

  const octokit = getOctokit();
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
      .parserConfiguration({ 'boolean-negation': false })
      .option('dry-run', {
        type: 'boolean',
        default: false,
        description: 'Run in dry-run mode without publishing',
      })
      .option('github-release', {
        type: 'boolean',
        default: false,
        description: 'Create a GitHub draft release after publishing',
      });
  },
  handler: async (argv) => {
    const { dryRun = false, githubRelease = false } = argv;

    if (dryRun) {
      console.log('🧪 Running in DRY RUN mode - no actual publishing will occur\n');
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

    if (!version) {
      throw new Error('No valid version found in root package.json');
    }

    // Early validation for GitHub release (before any publishing)
    let githubReleaseData = null;
    if (githubRelease) {
      console.log(`📋 Release version: ${version}`);
      githubReleaseData = await validateGitHubRelease(version);
    }

    // Publish to npm (pnpm handles duplicate checking automatically)
    // No git checks, we'll do our own
    await publishToNpm(allPackages, { dryRun, noGitChecks: true });

    // Create git tag when not doing GitHub release
    await createGitTag(version, dryRun);

    // Create GitHub release or git tag after successful npm publishing
    if (githubRelease && githubReleaseData) {
      if (dryRun) {
        console.log('\n🚀 Would create GitHub draft release (dry-run)');
        console.log(githubReleaseData?.changelogContent);
      } else {
        await createRelease(
          githubReleaseData.version,
          githubReleaseData.changelogContent,
          githubReleaseData.repoInfo,
        );
      }
    }

    console.log('\n🏁 Publishing complete!');
  },
});
