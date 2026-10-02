#!/usr/bin/env node
// Read the manifest or one group from a collector snapshot without printing the fleet snapshot.

import { readFile } from 'node:fs/promises';

class CliUsageError extends Error {}

/** Print command help. */
function printHelp() {
  process.stdout.write(
    [
      'Usage: node scripts/read-group.mjs <snapshot-file>',
      '       node scripts/read-group.mjs <snapshot-file> <group-id>',
      'Print a compact group manifest or the selected group from a collector snapshot.',
      '',
    ].join('\n'),
  );
}

/** Read and parse a collector snapshot. */
async function readSnapshot(snapshotFile) {
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(snapshotFile, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read snapshot ${snapshotFile}: ${error.message}`);
  }
  if (!Array.isArray(snapshot.groups) || !Array.isArray(snapshot.pullRequests)) {
    throw new Error(`Snapshot ${snapshotFile} is missing groups or pullRequests.`);
  }
  return snapshot;
}

/** Print the small amount of data needed to choose the next group. */
function printManifest(snapshot) {
  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: snapshot.generatedAt,
        totalGroups: snapshot.groups.length,
        totalPullRequests: snapshot.pullRequests.length,
        groups: snapshot.groups.map(({ id, key, kind, updates, pullRequests }) => ({
          id,
          key,
          kind,
          updates,
          pullRequests,
        })),
      },
      null,
      2,
    )}\n`,
  );
}

/** Print only the selected group and the context needed to review it. */
function printGroup(snapshot, groupId) {
  const group = snapshot.groups.find((candidate) => candidate.id === groupId);
  if (!group) {
    throw new CliUsageError(`Unknown group: ${groupId}`);
  }

  const groupPullRequests = snapshot.pullRequests.filter(
    (pullRequest) => pullRequest.group === groupId,
  );
  const repositories = new Set(groupPullRequests.map((pullRequest) => pullRequest.repository));
  const groupPullRequestKeys = new Set(
    groupPullRequests.map((pullRequest) => `${pullRequest.repository}#${pullRequest.number}`),
  );
  const dependencies = (snapshot.dependencies ?? []).filter((dependency) =>
    dependency.pullRequests.some((pullRequest) =>
      groupPullRequestKeys.has(`${pullRequest.repository}#${pullRequest.number}`),
    ),
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: snapshot.generatedAt,
        position: snapshot.groups.findIndex((candidate) => candidate.id === groupId) + 1,
        totalGroups: snapshot.groups.length,
        group,
        dependencies,
        repositories: (snapshot.repositories ?? []).filter((summary) =>
          repositories.has(summary.repository),
        ),
        pullRequests: groupPullRequests,
      },
      null,
      2,
    )}\n`,
  );
}

const [snapshotFile, groupId] = process.argv.slice(2);
try {
  if (snapshotFile === '--help' || snapshotFile === '-h') {
    printHelp();
  } else if (!snapshotFile || process.argv.length > 4) {
    throw new CliUsageError('Usage: node scripts/read-group.mjs <snapshot-file> [group-id]');
  } else {
    const snapshot = await readSnapshot(snapshotFile);
    if (groupId) {
      printGroup(snapshot, groupId);
    } else {
      printManifest(snapshot);
    }
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error instanceof CliUsageError ? 2 : 1;
}
