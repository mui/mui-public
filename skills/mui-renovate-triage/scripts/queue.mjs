#!/usr/bin/env node
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

const statuses = ['unreviewed', 'queued', 'skipped', 'waiting-ci', 'merged', 'closed'];
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { note: { type: 'string' }, reviewed: { type: 'boolean' } },
});
const [statePath, command, subject, status] = positionals;
if (
  !statePath ||
  !['sync', 'mark', 'show'].includes(command) ||
  (command === 'sync' && positionals.length !== 3) ||
  (command === 'show' && positionals.length !== 2) ||
  (command === 'mark' && (positionals.length !== 4 || !statuses.includes(status) || !values.note))
) {
  throw new Error(
    'Usage: node queue.mjs STATE sync SNAPSHOT | show | mark REPO#PR STATUS --note TEXT [--reviewed]',
  );
}
let queue;
try {
  queue = JSON.parse(await readFile(statePath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
  queue = {};
}

if (command === 'sync') {
  const snapshot = JSON.parse(await readFile(subject, 'utf8'));
  for (const pull of snapshot.pullRequests) {
    const key = `${pull.repository}#${pull.number}`;
    const entry = queue[key] ?? { status: 'unreviewed' };
    entry.pullRequest = pull;
    entry.observedAt = snapshot.generatedAt;
    const remoteState = (pull.state ?? 'OPEN').toLowerCase();
    if (['merged', 'closed'].includes(remoteState)) {
      entry.status = remoteState;
    } else if (['merged', 'closed'].includes(entry.status)) {
      entry.status = 'unreviewed';
    }
    // New commits invalidate analysis, never the user's skip or queue decision.
    entry.analysisStale = entry.reviewedHead !== pull.headRefOid;
    queue[key] = entry;
  }
} else if (command === 'mark') {
  const entry = queue[subject];
  if (!entry) {
    throw new Error('Refresh this PR and sync its snapshot before marking it');
  }
  Object.assign(entry, { status, note: values.note, decidedAt: new Date().toISOString() });
  if (values.reviewed) {
    entry.reviewedHead = entry.pullRequest.headRefOid;
    entry.analysisStale = false;
  }
}

if (command !== 'show') {
  await mkdir(dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(queue, null, 2)}\n`);
  await rename(temporary, statePath);
}
const counts = Object.fromEntries(statuses.map((value) => [value, 0]));
const remaining = [];
for (const [key, entry] of Object.entries(queue)) {
  counts[entry.status] += 1;
  if (entry.status === 'unreviewed') {
    remaining.push(key);
  }
}
process.stdout.write(`${JSON.stringify({ counts, remaining }, null, 2)}\n`);
