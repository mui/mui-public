#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * @typedef {import('../utils/pnpm.mjs').PublicPackage} PublicPackage
 * @typedef {import('../utils/pnpm.mjs').PublishOptions} PublishOptions
 */

import select from '@inquirer/select';
import { createActionAuth } from '@octokit/auth-action';
import { Octokit } from '@octokit/rest';
import chalk from 'chalk';
import { $ } from 'execa';
import gitUrlParse from 'git-url-parse';
import isCI from 'is-ci';
import * as fs from 'node:fs/promises';
import * as semver from 'semver';

import { persistentAuthStrategy } from '../utils/github.mjs';
import { getWorkspacePackages, publishPackages } from '../utils/pnpm.mjs';

function getOctokit() {
  return new Octokit({ authStrategy: isCI ? createActionAuth : persistentAuthStrategy });
}

/**
 * @typedef {Object} Args
 * @property {boolean} dry-run Run in dry-run mode without publishing
 * @property {boolean} github-release Create a GitHub draft release after publishing
 * @property {string} tag NPM dist tag to publish to
 * @property {boolean} ci Runs in CI environment
 * @property {string} [sha] Git SHA to use for the GitHub release workflow (local only)
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

    const startIndex = lines.findIndex(
      (line) => line.startsWith(`## ${version}`) || line.startsWith(`## v${version}`),
    );

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
 * @param {string[]} [remotes=['origin']] - Remote name(s) to check (default: 'origin')
 * @returns {Promise<{owner: string, repo: string}>} Repository owner and name
 */
async function getRepositoryInfo(remotes = ['origin']) {
  /**
   * @type {{owner: string, repo: string} | undefined}
   */
  let result;

  for (let i = 0; i < remotes.length; i += 1) {
    const remote = remotes[i];
    try {
      // eslint-disable-next-line no-await-in-loop
      const cliResult = await $`git remote get-url ${remote}`;
      const url = cliResult.stdout.trim();

      const parsed = gitUrlParse(url);
      if (parsed.source !== 'github.com' && parsed.owner !== 'mui') {
        throw new Error('Repository is not hosted on GitHub or the owner is not "mui"');
      }

      result = {
        owner: parsed.owner,
        repo: parsed.name,
      };
      break;
    } catch (/** @type {any} */ error) {
      const execaError = /** @type {import('execa').ExecaError} */ (error);
      if (
        i < remotes.length - 1 &&
        typeof execaError.stderr === 'string' &&
        execaError.stderr.includes('No such remote')
      ) {
        continue; // Try next remote
      }
      throw new Error(`Failed to get repository info: ${error.message}`);
    }
  }
  if (!result) {
    throw new Error(`Failed to determine repository info from remotes: ${remotes.join(', ')}`);
  }
  return result;
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
    await $({
      env: {
        ...process.env,
        GIT_COMMITTER_NAME: 'Code infra',
        GIT_COMMITTER_EMAIL: 'code-infra@mui.com',
      },
    })`git tag -a ${tagName} -m ${`Version ${version}`}`;
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
  await publishPackages(packages, options);
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
      })
      .option('tag', {
        type: 'string',
        default: 'latest',
        description: 'NPM dist tag to publish to',
      })
      .option('ci', {
        type: 'boolean',
        default: isCI,
        description:
          'Runs in CI environment. On local environments, it triggers the GitHub publish workflow instead of publishing directly.',
      })
      .option('sha', {
        type: 'string',
        description: 'Git SHA to use for the GitHub release workflow (local only)',
      });
  },
  handler: async (argv) => {
    const { dryRun = false, githubRelease = false, tag = 'latest', sha } = argv;

    if (argv.ci && sha) {
      throw new Error('The --sha option can only be used in non-CI environments');
    }

    if (dryRun) {
      console.log('🧪 Running in DRY RUN mode - no actual publishing will occur\n');
    }

    if (!argv.ci) {
      await triggerLocalGithubPublishWorkflow(argv);
      return;
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

    const newPackages = await getWorkspacePackages({ nonPublishedOnly: true });

    if (newPackages.length > 0) {
      throw new Error(
        `The following packages are new and need to be published manually first: ${newPackages.join(
          ', ',
        )}. Read more about it here: https://github.com/mui/mui-public/blob/master/packages/code-infra/README.md#adding-and-publishing-new-packages`,
      );
    }

    // Publish to npm (pnpm handles duplicate checking automatically)
    // No git checks, we'll do our own
    await publishToNpm(allPackages, { dryRun, noGitChecks: true, tag });

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

const WORKFLOW_PATH = 'workflows/publish.yml';
const PUBLISH_WORKFLOW_ID = `.github/${WORKFLOW_PATH}`;

/**
 * @param {Omit<Args, 'ci'>} opts
 */
async function triggerLocalGithubPublishWorkflow(opts) {
  console.log(`🔍 Checking if there are new packages to publish in the workspace...`);
  const newPackages = await getWorkspacePackages({ nonPublishedOnly: true });
  if (newPackages.length) {
    console.warn(
      `⚠️  Found new packages that should be published to npm first before triggering a release:
  * ${newPackages.map((pkg) => pkg.name).join('  * ')}
Please run the command "${chalk.bold('pnpm code-infra publish-new-package')}" first to publish and configure npm.`,
    );
    return;
  }
  console.log('✅ No new packages found, proceeding...');
  const repoInfo = await getRepositoryInfo(['upstream', 'origin']);
  console.log(`📂 Repository: ${repoInfo.owner}/${repoInfo.repo}`);
  const params = {
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    workflow_id: PUBLISH_WORKFLOW_ID,
  };
  const octokit = getOctokit();

  try {
    const sha = opts.sha || (await determineGitSha(octokit, repoInfo));
    if (!sha) {
      console.error('❌🚨 No commit SHA provided, cannot proceed.');
      return;
    }

    const res = await octokit.actions.createWorkflowDispatch({
      ...params,
      ref: 'master',
      inputs: {
        sha,
        'dry-run': opts['dry-run'] ? 'true' : 'false',
        'github-release': opts['github-release'] ? 'true' : 'false',
        'dist-tag': opts.tag,
      },
    });
    if (res.status > 204) {
      console.error('❌🚨 Error creating release.');
    } else {
      console.log(
        `🎉✅ Release created successfully! Check the status at: https://github.com/${params.owner}/${params.repo}/actions/${WORKFLOW_PATH} .`,
      );
    }
  } catch (error) {
    const err =
      /** @type {import('@octokit/types').RequestError & {response: {data: {message: string; documentation_url: string}}}} */ (
        error
      );
    const manualTriggerUrl = `You can also trigger the workflow manually at: https://github.com/${params.owner}/${params.repo}/actions/${WORKFLOW_PATH}`;
    if (err.status === 422) {
      console.error(`❌🚫 ${err.response.data.message}\n. ${manualTriggerUrl}`);
      return;
    }
    if (err.status === 403) {
      console.error(
        `❌🔒 The "Code Infra" Github app does not have sufficient permissions to perform this action on your behalf. Contact an admin to update the permissions.${err.response.data.documentation_url ? ` See ${err.response.data.documentation_url} for more information.` : ''}.
${manualTriggerUrl}`,
      );
      return;
    }
    console.error(`❌🔥 Error while invoking the publish workflow.\n. ${manualTriggerUrl}`);
    throw error;
  }
}

/**
 * @param {import('@octokit/rest').Octokit} octokit
 * @param {{owner: string; repo: string}} repoInfo
 * @returns {Promise<string | undefined>}
 */
async function determineGitSha(octokit, repoInfo) {
  console.log(`🔍 Determining the git SHA to use for the release...`);
  // Avoid the deprecation warning when calling octokit.search.issuesAndPullRequests
  // It has been deprecated but new method is not available in @octokit/rest yet.
  octokit.log.warn = () => {};
  const pulls = (
    await octokit.search.issuesAndPullRequests({
      advanced_search: 'true',
      q: `is:pr is:merged label:release repo:${repoInfo.owner}/${repoInfo.repo}`,
      per_page: 1,
    })
  ).data.items;
  if (!pulls.length) {
    console.log(`❌🚨 Could not find any merged release PRs in the repository.`);
    return undefined;
  }

  console.log(
    `🫆  Found the latest merged release PR: ${chalk.bold(pulls[0].title)} (${pulls[0].html_url})`,
  );

  const commits = (
    await octokit.search.commits({
      q: `repo:${repoInfo.owner}/${repoInfo.repo} author:${pulls[0].user?.login} [release]`,
      per_page: 100,
    })
  ).data.items;

  if (!commits.length) {
    console.error(
      `❌🚨 Could not find any commits associated with the release PR: ${pulls[0].html_url}`,
    );
    return undefined;
  }
  const relevantData = commits.map((commit) => ({
    value: commit.sha,
    name: `(${commit.sha.slice(0, 7)}) ${commit.commit.message.split('\n')[0]} by ${commit.author?.login ?? 'no author'} on ${new Date(commit.commit.committer?.date ?? '').toISOString()}`,
    desciption: commit.commit.message,
  }));

  const result = await select({
    message: 'Select the commit to release from:',
    choices: relevantData,
    default: relevantData[0].value,
  });
  return result;
}
