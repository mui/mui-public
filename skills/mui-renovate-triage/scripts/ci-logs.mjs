#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs, promisify, stripVTControlCharacters } from 'node:util';

const { positionals } = parseArgs({ allowPositionals: true });
const [provider, repository, job, output] = positionals;
if (
  positionals.length !== 4 ||
  !['github', 'circleci'].includes(provider) ||
  !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
  !/^[1-9][0-9]*$/.test(job)
) {
  throw new Error('Usage: node ci-logs.mjs github|circleci OWNER/REPO JOB_ID OUTPUT');
}

/** Fetch provider JSON with a bounded network timeout. */
async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    // Output URLs may be signed; do not include them in errors or reports.
    throw new Error(`CI log request failed: HTTP ${response.status}`);
  }
  return response.json();
}

let log;
if (provider === 'github') {
  const result = await promisify(execFile)(
    'gh',
    ['run', 'view', '--repo', repository, '--job', job, '--log-failed'],
    { maxBuffer: 100 * 1024 * 1024 },
  );
  log = result.stdout;
} else {
  const data = await readJson(`https://circleci.com/api/v1.1/project/github/${repository}/${job}`);
  const actions = (data.steps ?? []).flatMap((step) =>
    (step.actions ?? [])
      .filter((action) => action.failed || ['failed', 'timedout'].includes(action.status))
      .map((action) => ({ name: step.name ?? 'unnamed', outputUrl: action.output_url })),
  );
  const chunks = await Promise.all(
    actions.map(async (action) => {
      const messages = action.outputUrl ? await readJson(action.outputUrl) : [];
      return `\nSTEP: ${action.name}\n${messages.map((item) => item.message ?? '').join('')}`;
    }),
  );
  log = chunks.join('');
}
log = stripVTControlCharacters(log);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, log);
// Candidates are search pointers; read context in the saved full log before diagnosing.
const candidates = log
  .split('\n')
  .map((text, index) => ({ line: index + 1, text }))
  .filter((item) => /error|failed|exception|assertion|timed? ?out/i.test(item.text))
  .slice(0, 20)
  .map((item) => ({ ...item, text: item.text.slice(0, 500) }));
process.stdout.write(
  `${JSON.stringify({ log: output, empty: !log.trim(), candidates }, null, 2)}\n`,
);
