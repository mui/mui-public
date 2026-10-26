import fs from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { getWorkspacePackages } from '../utils/pnpm.mjs';
import { findLatestTaggedVersion, getRepositoryInfo, getCurrentGitSha } from '../utils/git.mjs';
import { loadChangelogConfig } from './loadChangelogConfig.mjs';
import { buildSections } from './buildSections.mjs';
import { categorizeCommits } from './categorizeCommits.mjs';
import { fetchCommitsBetweenRefs } from './fetchChangelogs.mjs';
import { filterCommits } from './filterCommits.mjs';
import { extractContributorsFromAllCommits, renderChangelog } from './renderChangelog.mjs';
import { sortSections } from './sortSections.mjs';

const DEFAULT_CONFIG = 'scripts/changelog.config.mjs';

/**
 * Generate a release entry using the repository's config and authenticated GitHub client.
 * @param {import('./types.ts').GenerateChangelogOptions} [options]
 * @returns {Promise<import('./types.ts').GenerateChangelogResult>}
 */
export async function generateChangelog(options = {}) {
  const cwd = await fs.realpath(options.cwd ?? process.cwd());
  const config =
    typeof options.config === 'object'
      ? options.config
      : await loadChangelogConfig(options.config ?? DEFAULT_CONFIG, cwd);
  const repository = options.repo
    ? { repo: options.repo, owner: options.org ?? 'mui' }
    : await getRepositoryInfo(cwd);
  const release = {
    lastRelease: options.lastRelease ?? (await findLatestTaggedVersion({ cwd })),
    release:
      !options.release || options.release === 'HEAD'
        ? await getCurrentGitSha(cwd)
        : options.release,
    version:
      options.version ??
      JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8')).version,
    date: options.date ?? new Date(),
  };
  const allCommits = await fetchCommitsBetweenRefs({
    repo: repository.repo,
    org: options.org ?? repository.owner,
    lastRelease: release.lastRelease,
    release: release.release,
    octokit: options.octokit,
  });
  const commits = filterCommits(allCommits, config.filter);
  const contributors = extractContributorsFromAllCommits(
    config.contributors?.source === 'all' ? allCommits : commits,
    config.filter?.excludeAuthorsFromContributors,
  );

  const categories = categorizeCommits(commits, config.categorization);
  const { versions, unchanged } = await getPackageVersions(cwd, release.lastRelease, config);
  let builtSections = buildSections(categories, config.categorization, versions);
  if (config.categorization.packageNaming?.omitUnavailable && versions) {
    const naming = config.categorization.packageNaming;
    const packages = new Set([
      ...Object.values(naming.mappings),
      ...Object.values(naming.plans ?? {}).flatMap((plans) => Object.values(plans)),
    ]);
    builtSections = builtSections.flatMap((section) => {
      if (!section.subsections) {
        return [section];
      }
      const subsections = section.subsections.filter(
        (subsection) => !packages.has(subsection.key) || versions.has(subsection.key),
      );
      return subsections.length > 0 ? [{ ...section, subsections }] : [];
    });
  }
  const visibleSections = builtSections.filter((section) => {
    if (
      !section.subsections ||
      section.subsections.some((subsection) => subsection.commits.length > 0)
    ) {
      return true;
    }
    return section.subsections.some((subsection) => !unchanged.has(subsection.key));
  });
  const sections = sortSections(visibleSections, config.categorization);
  return {
    markdown: renderChangelog(sections, config, release, contributors),
    sections,
    contributors,
  };
}

/**
 * Compare package manifests, not changed paths: dependency-only bumps still need an entry.
 * @param {string} cwd
 * @param {string} lastRelease
 * @param {import('./types.ts').ChangelogConfig} config
 */
async function getPackageVersions(cwd, lastRelease, config) {
  /** @type {Map<string, string>} */
  const versions = new Map();
  /** @type {Set<string>} */
  const unchanged = new Set();
  if (config.categorization.strategy !== 'package') {
    return { versions: undefined, unchanged };
  }

  let packages;
  try {
    packages = await getWorkspacePackages({ publicOnly: true, cwd });
  } catch {
    console.warn('Cannot load workspace package versions; rendering without package versions.');
    return { versions: undefined, unchanged };
  }
  for (const pkg of packages) {
    versions.set(pkg.name, pkg.version);
  }
  if (!config.categorization.packageNaming?.omitUnchanged) {
    return { versions, unchanged };
  }

  const base = await execa('git', ['rev-parse', '--verify', `${lastRelease}^{commit}`], {
    cwd,
    reject: false,
  });
  if (base.exitCode !== 0) {
    console.warn(
      `Cannot compare package versions against ${lastRelease}: ref is not available locally; retaining empty package sections.`,
    );
    return { versions, unchanged };
  }

  const naming = config.categorization.packageNaming;
  const configuredPackages = new Set([
    ...Object.values(naming.mappings),
    ...Object.values(naming.plans ?? {}).flatMap((plans) => Object.values(plans)),
  ]);
  await Promise.all(
    packages
      .filter((pkg) => configuredPackages.has(pkg.name))
      .map(async (pkg) => {
        const manifest = path
          .relative(cwd, path.join(pkg.path, 'package.json'))
          .split(path.sep)
          .join('/');
        const previous = await execa('git', ['show', `${lastRelease}:${manifest}`], {
          cwd,
          reject: false,
        });
        if (previous.exitCode === 0 && JSON.parse(previous.stdout).version === pkg.version) {
          unchanged.add(pkg.name);
        }
      }),
  );
  return { versions, unchanged };
}
