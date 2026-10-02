#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs, promisify, stripVTControlCharacters } from 'node:util';
import { fetchNetlifyLogs } from './netlify-logs.mjs';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { head: { type: 'string' } },
});
const [provider, repository, job, output] = positionals;
if (
  positionals.length !== 4 ||
  !['github', 'circleci', 'netlify'].includes(provider) ||
  !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
  !(provider === 'netlify' ? /^[a-f0-9]{24}$/i : /^[1-9][0-9]*$/).test(job) ||
  (provider === 'netlify' ? !/^[a-f0-9]{40}$/i.test(values.head ?? '') : values.head !== undefined)
) {
  throw new Error(
    'Usage: node ci-logs.mjs github|circleci OWNER/REPO JOB_ID OUTPUT\n' +
      '       node ci-logs.mjs netlify OWNER/REPO DEPLOY_ID OUTPUT --head SHA',
  );
}

// CircleCI's API is anonymous for public projects only; a personal API token
// unlocks private ones (mui/base-ui-mosaic).
const CIRCLE_TOKEN = process.env.CIRCLE_TOKEN || process.env.CIRCLECI_TOKEN || '';

/** Fetch provider JSON with a bounded network timeout. */
async function readJson(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    // Output URLs may be signed; do not include them in errors or reports.
    const hint =
      [401, 403, 404].includes(response.status) && !CIRCLE_TOKEN && provider === 'circleci'
        ? ' The project may be private; set CIRCLE_TOKEN to a CircleCI personal API token.'
        : '';
    throw new Error(`CI log request failed: HTTP ${response.status}.${hint}`);
  }
  return response.json();
}

let log;
let evidence;
if (provider === 'github') {
  const result = await promisify(execFile)(
    'gh',
    ['run', 'view', '--repo', repository, '--job', job, '--log-failed'],
    { maxBuffer: 100 * 1024 * 1024 },
  );
  log = result.stdout;
} else if (provider === 'netlify') {
  const result = await fetchNetlifyLogs(job, values.head);
  log = result.log;
  evidence = result.evidence;
} else {
  const authHeaders = CIRCLE_TOKEN ? { 'Circle-Token': CIRCLE_TOKEN } : {};
  const data = await readJson(
    `https://circleci.com/api/v1.1/project/github/${repository}/${job}`,
    authHeaders,
  );
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
if (!log.trim()) {
  throw new Error('CI log retrieval returned no log content');
}
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
  `${JSON.stringify({ log: output, empty: false, ...evidence, candidates }, null, 2)}\n`,
);
