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
 * @typedef {Object} Commit
 * @property {string} sha - Commit SHA
 * @property {string} message - Commit message
 * @property {string} author - Commit author
 */

/**
 * @param {Object} param0
 * @param {string} param0.packagePath
 * @returns {Promise<Commit[]>} Commits between the tag and current HEAD for the package
 */
async function fetchCommitsForPackage({ packagePath }) {
  /**
   * @type {Commit[]}
   */
  const results = [];
  const fieldSeparator = '\u001f'; // ASCII unit separator is extremely unlikely to appear in git metadata
  const formatArg = '--format=%H%x1f%s%x1f%an%x1f%ae'; // SHA, subject, author name, author email separated by unit separator
  const res = $`git log --oneline --no-decorate ${
    // to avoid escaping by execa
    [formatArg]
  } ${CANARY_TAG}..HEAD -- ${packagePath}`;
  for await (const line of res) {
    const commitLine = line.trimEnd();
    if (!commitLine) {
      continue;
    }
    const parts = commitLine.split(fieldSeparator);
    if (parts.length < 3) {
      console.error(`Failed to parse commit log line: ${commitLine}`);
      continue;
    }
    const [sha, message, commitAuthor, commitEmail] = parts;
    let author = commitAuthor;
    // try to get github username from email
    if (commitEmail) {
      const emailUsername = commitEmail.split('@')[0];
      if (emailUsername) {
        const [, githubUserName] = emailUsername.split('+');
        if (githubUserName) {
          author = `@${githubUserName}`;
        }
      }
    }
    results.push({ sha, message, author });
  }
  return results;
}

const AUTHOR_EXCLUDE_LIST = ['renovate[bot]', 'dependabot[bot]'];

/**
 * @param {string} message
 * @returns {string}
 */
function cleanupCommitMessage(message) {
  // AI generated: clean up commit message by removing leading bracketed tokens except [breaking]
  let msg = message || '';

  // Extract and remove leading bracketed tokens like "[foo][bar] message"
  const tokens = [];
  const bracketRe = /^\s*\[([^\]]+)\]\s*/;
  let match = msg.match(bracketRe);
  while (match) {
    tokens.push(match[1]);
    msg = msg.slice(match[0].length);
    match = msg.match(bracketRe);
  }
  msg = msg.trim();

  // If any of the leading tokens is "breaking" keep that token (preserve original casing)
  const breakingToken = tokens.find((t) => t.toLowerCase() === 'breaking');
  const prefix = breakingToken ? `[${breakingToken}]${msg ? ' ' : ''}` : '';

  return `${prefix}${msg}`.trim();
}

async function getPackagesWithDependencies() {
  /**
   * @type {(PublicPackage & { dependencies: Record<string, unknown>; private: boolean; })[]}
   */
  const packagesWithDeps = JSON.parse(
    (await $`pnpm ls -r --json --exclude-peers --only-projects --prod`).stdout,
  );
  /** @type {Record<string, string[]>} */
  const directPkgDependencies = packagesWithDeps
    .filter((pkg) => !pkg.private)
    .reduce((acc, pkg) => {
      if (!pkg.name) {
        return acc;
      }
      const deps = Object.keys(pkg.dependencies || {});
      if (!deps.length) {
        return acc;
      }
      acc[pkg.name] = deps;
      return acc;
    }, /** @type {Record<string, string[]>} */ ({}));

  // Compute transitive (nested) dependencies limited to workspace packages and avoid cycles.
  const workspacePkgNames = new Set(Object.keys(directPkgDependencies));
  const nestedMap = /** @type {Record<string, string[]>} */ ({});

  /**
   *
   * @param {string} pkgName
   * @returns {string[]}
   */
  const getTransitiveDeps = (pkgName) => {
    /**
     * @type {Set<string>}
     */
    const seen = new Set();
    const stack = (directPkgDependencies[pkgName] || []).slice();

    while (stack.length) {
      const dep = stack.pop();
      if (!dep || seen.has(dep)) {
        continue;
      }
      // Only consider workspace packages for transitive expansion
      if (!workspacePkgNames.has(dep)) {
        // still record external deps as direct deps but don't traverse into them
        seen.add(dep);
        continue;
      }
      seen.add(dep);
      const children = directPkgDependencies[dep] || [];
      for (const c of children) {
        if (!seen.has(c)) {
          stack.push(c);
        }
      }
    }

    return Array.from(seen);
  };

  for (const name of Object.keys(directPkgDependencies)) {
    nestedMap[name] = getTransitiveDeps(name);
  }

  return nestedMap;
}

/**
 * Prepare changelog data for packages using GitHub API
 * @param {PublicPackage[]} packagesToPublish - Packages that will be published
 * @param {PublicPackage[]} allPackages - All packages in the repository
 * @param {Map<string, string>} canaryVersions - Map of package names to their canary versions
 * @returns {Promise<Map<string, string[]>>} Map of package names to their changelogs
 */
async function prepareChangelogsFromGitCli(packagesToPublish, allPackages, canaryVersions) {
  /**
   * @type {Map<string, string[]>}
   */
  const changelogs = new Map();

  await Promise.all(
    packagesToPublish.map(async (pkg) => {
      const commits = await fetchCommitsForPackage({ packagePath: pkg.path });
      if (commits.length > 0) {
        console.log(`Found ${commits.length} commits for package ${pkg.name}`);
      }
      const changeLogStrs = commits
        // Exclude commits authored by bots
        .filter(
          // We want to allow commits from copilot or other AI tools, so only filter known bots
          (commit) => !AUTHOR_EXCLUDE_LIST.includes(commit.author),
        )
        .map((commit) => `- ${cleanupCommitMessage(commit.message)} by ${commit.author}`);

      if (changeLogStrs.length > 0) {
        changelogs.set(pkg.name, changeLogStrs);
      }
    }),
  );
  // Second pass: check for dependency updates in other packages not part of git history
  const pkgDependencies = await getPackagesWithDependencies();

  for (let i = 0; i < allPackages.length; i += 1) {
    const pkg = allPackages[i];
    const depsToPublish = (pkgDependencies[pkg.name] ?? []).filter((dep) =>
      packagesToPublish.some((p) => p.name === dep),
    );
    if (depsToPublish.length === 0) {
      continue;
    }
    const changelog = changelogs.get(pkg.name) ?? [];
    changelog.push('- Updated dependencies:');
    depsToPublish.forEach((dep) => {
      const depVersion = canaryVersions.get(dep);
      if (depVersion) {
        changelog.push(`  - Bumped \`${dep}@${depVersion}\``);
      }
    });
  }
  return changelogs;
}

/**
 * Prepare changelog data for packages
 * @param {PublicPackage[]} packagesToPublish - Packages that will be published
 * @param {PublicPackage[]} allPackages - All packages in the repository
 * @param {Map<string, string>} canaryVersions - Map of package names to their canary versions
 * @returns {Promise<Map<string, string[]>>} Map of package names to their changelogs
 */
async function prepareChangelogsForPackages(packagesToPublish, allPackages, canaryVersions) {
  console.log('\n📝 Preparing changelogs for packages...');

  const repoInfo = await getRepositoryInfo();
  console.log(`📂 Repository: ${repoInfo.owner}/${repoInfo.repo}`);

  /**
   * @type {Map<string, string[]>}
   */
  const changelogs = await prepareChangelogsFromGitCli(
    packagesToPublish,
    allPackages,
    canaryVersions,
  );

  // Log changelog content for each package
  for (const pkg of packagesToPublish) {
    const version = canaryVersions.get(pkg.name);
    if (!version) {
      continue;
    }

    const changelog = changelogs.get(pkg.name) || [];
    console.log(`\n📦 ${pkg.name}@${version}`);
    if (changelog.length > 0) {
      console.log(
        `   Changelog:\n${changelog.map((/** @type {string} */ line) => `   ${line}`).join('\n')}`,
      );
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
    let basePkgJson = await readPackageJson(pkg.path);
    let pkgJsonDirectory = pkg.path;
    if (basePkgJson.publishConfig?.directory) {
      pkgJsonDirectory = path.join(pkg.path, basePkgJson.publishConfig.directory);
      basePkgJson = await readPackageJson(pkgJsonDirectory);
    }

    const canaryVersion = canaryVersions.get(pkg.name);
    if (canaryVersion) {
      const updatedPackageJson = {
        ...basePkgJson,
        version: canaryVersion,
        gitSha,
      };
      await writePackageJson(pkgJsonDirectory, updatedPackageJson);
      console.log(`📝 Updated ${pkg.name} package.json to ${canaryVersion}`);
    }
    return { pkg, basePkgJson, pkgJsonDirectory };
  });

  const updateResults = await Promise.all(packageUpdatePromises);

  // Prepare changelogs before building and publishing (so it can error out early if there are issues)
  /**
   * @type {Map<string, string[]>}
   */
  let changelogs = new Map();
  if (options.githubRelease) {
    changelogs = await prepareChangelogsForPackages(packagesToPublish, allPackages, canaryVersions);
  }

  // Third pass: publish only the changed packages using recursive publish
  let publishSuccess = false;
  try {
    console.log(`📤 Publishing ${packagesToPublish.length} canary versions...`);
    await publishPackages(packagesToPublish, { ...options, noGitChecks: true, tag: CANARY_TAG });

    packagesToPublish.forEach((pkg) => {
      const canaryVersion = canaryVersions.get(pkg.name);
      console.log(`✅ Published ${pkg.name}@${canaryVersion}`);
    });
    publishSuccess = true;
  } finally {
    // Always restore original package.json files in parallel
    console.log('\n🔄 Restoring original package.json files...');
    const restorePromises = updateResults.map(async ({ pkg, basePkgJson, pkgJsonDirectory }) => {
      // no need to restore package.json files in build directories
      if (pkgJsonDirectory === pkg.path) {
        await writePackageJson(pkg.path, basePkgJson);
      }
    });

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
