#!/usr/bin/env node
// Collect open MUI Renovate PRs and normalize their current review signals as JSON.

import { parseArgs } from 'node:util';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  assertGitHubAuth,
  fetchBaseHead,
  fetchPullRequest,
  mapConcurrent,
  searchRepository,
} from './lib/github.mjs';
import { groupPullRequests, indexDependencies, summarizeRepository } from './lib/groups.mjs';
import { getMergeBlockers } from './lib/normalize.mjs';

const DEFAULT_REPOSITORIES = [
  'mui/base-ui',
  'mui/material-ui',
  'mui/mui-public',
  'mui/mui-x',
  'mui/base-ui-plus',
  'mui/base-ui-mosaic',
  'mui/base-ui-charts',
];
const DEFAULT_AUTHOR_QUERIES = ['app/code-infra-renovate', 'app/renovate'];
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

class CliUsageError extends Error {}

/** Return the current time in the collector's stable second-precision format. */
function getGeneratedAt() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Print command help. */
function printHelp() {
  process.stdout.write(
    [
      'Usage: node scripts/collect-prs.mjs [owner/repo ...]',
      '       node scripts/collect-prs.mjs --pr <owner/repo> <number>',
      'Collect open PRs authored by code-infra-renovate[bot] or renovate[bot] as JSON.',
      '--pr exits 0 when merge checks pass, 1 for blockers or fetch errors, 2 for invalid usage.',
      '',
    ].join('\n'),
  );
}

/** Validate a repository name supplied on the command line. */
function validateRepository(repository) {
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new CliUsageError(`Invalid repository: ${repository} (expected owner/repo)`);
  }
}

/** Run the collector CLI. */
async function main() {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        pr: { type: 'boolean' },
      },
    }));
  } catch (error) {
    throw new CliUsageError(error.message);
  }

  if (values.help) {
    printHelp();
    return;
  }

  let singlePullRequest;
  let repositories;
  if (values.pr) {
    const [repository, pullRequestNumber] = positionals;
    if (
      positionals.length !== 2 ||
      !REPOSITORY_PATTERN.test(repository) ||
      !/^[0-9]+$/.test(pullRequestNumber)
    ) {
      throw new CliUsageError('Usage: node scripts/collect-prs.mjs --pr <owner/repo> <number>');
    }
    singlePullRequest = { repository, pullRequestNumber };
  } else {
    repositories = positionals.length > 0 ? positionals : DEFAULT_REPOSITORIES;
    repositories.forEach(validateRepository);
  }

  const concurrencyText = process.env.MUI_RENOVATE_CONCURRENCY || '8';
  const concurrency = Number(concurrencyText);
  if (!/^[1-9][0-9]*$/.test(concurrencyText) || !Number.isSafeInteger(concurrency)) {
    throw new CliUsageError('MUI_RENOVATE_CONCURRENCY must be a positive integer.');
  }

  await assertGitHubAuth();

  if (singlePullRequest) {
    const pullRequest = await fetchPullRequest(
      singlePullRequest.repository,
      singlePullRequest.pullRequestNumber,
    );
    const mergeBlockers = getMergeBlockers(pullRequest);
    process.stdout.write(
      `${JSON.stringify(
        {
          generatedAt: getGeneratedAt(),
          scope: 'single',
          pullRequests: [pullRequest],
          mergeBlockers,
        },
        null,
        2,
      )}\n`,
    );
    if (mergeBlockers.length > 0) {
      process.stderr.write(`${mergeBlockers.join('\n')}\n`);
      process.exitCode = 1;
    }
    return;
  }

  const authorQueries = process.env.MUI_RENOVATE_AUTHOR_QUERY
    ? [process.env.MUI_RENOVATE_AUTHOR_QUERY]
    : DEFAULT_AUTHOR_QUERIES;
  const searches = await Promise.all(
    repositories.map(async (repository) => ({
      repository,
      pullRequests: await searchRepository(repository, authorQueries),
    })),
  );
  const jobs = [];
  for (const { repository, pullRequests: repositoryPullRequests } of searches) {
    jobs.push(...repositoryPullRequests.map((pullRequest) => [repository, pullRequest.number]));
  }

  const pullRequests = await mapConcurrent(jobs, concurrency, ([repository, number]) =>
    fetchPullRequest(repository, number),
  );
  const groups = groupPullRequests(pullRequests);

  const repositoryResults = await Promise.all(
    searches.map(async ({ repository }) => {
      const own = pullRequests.filter((pullRequest) => pullRequest.repository === repository);
      const baseRefName = own[0]?.baseRefName ?? 'master';
      return summarizeRepository(repository, own, await fetchBaseHead(repository, baseRefName));
    }),
  );
  repositoryResults.sort((left, right) => left.repository.localeCompare(right.repository));

  // Worklist order: group by group (largest first), then repository, then number,
  // so one decision is made once and applied to every sibling in a row.
  const groupRank = new Map(groups.map((group, index) => [group.id, index]));
  pullRequests.sort(
    (left, right) =>
      groupRank.get(left.group) - groupRank.get(right.group) ||
      left.repository.localeCompare(right.repository) ||
      left.number - right.number,
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: getGeneratedAt(),
        authorQueries,
        repositories: repositoryResults,
        groups,
        dependencies: indexDependencies(pullRequests),
        pullRequests,
      },
      null,
      2,
    )}\n`,
  );
}

// argv[1] may be a symlink (e.g. .claude/skills -> skills); import.meta.url is the real path.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error instanceof CliUsageError ? 2 : 1;
  }
}
