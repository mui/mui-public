// Offline test for the CircleCI fetcher. Stands up a fake CircleCI API, runs fetch.mjs against
// it as a subprocess, and asserts the per-job files, their headers, and the classify signal.
//
// Run: node --test .github/sandbox/fetch.test.mjs

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FETCH = new URL('./fetch.mjs', import.meta.url).pathname;

// A tiny fake CircleCI: one v2 API for pipelines/workflows/jobs, one v1.1 API for job detail, and
// a log endpoint. `scenario` decides what the workflow/job layer returns. The handler returns no
// value on any branch (consistent-return): it writes the response and falls through.
function fakeCircleCI(scenario) {
  const now = new Date().toISOString();
  return createServer((request, response) => {
    const url = request.url || '';
    const json = (payload) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    };

    if (url.startsWith('/project/') && url.includes('/pipeline?')) {
      const items =
        scenario === 'no-pipelines'
          ? []
          : [
              {
                id: 'pipe-1',
                number: 100,
                created_at: now,
                vcs: { commit: { subject: 'fix the thing' } },
              },
            ];
      json({ items });
    } else if (url === '/pipeline/pipe-1/workflow') {
      const clean = scenario === 'clean';
      json({
        items: [
          {
            id: 'wf-1',
            name: clean ? 'build' : 'test',
            status: clean ? 'success' : 'failed',
            created_at: now,
          },
        ],
      });
    } else if (url === '/workflow/wf-1/job') {
      const job =
        scenario === 'no-failed-jobs'
          ? { job_number: 5, name: 'lint', status: 'success' }
          : { job_number: 7, name: 'unit', status: 'failed' };
      json({ items: [job] });
    } else if (url.startsWith('/project/') && url.endsWith('/7')) {
      const outputUrl = `http://127.0.0.1:${response.socket.localPort}/logs/7`;
      json({
        steps: [
          {
            name: 'run tests',
            actions: [{ failed: true, status: 'failed', output_url: outputUrl }],
          },
        ],
      });
    } else if (url === '/logs/7') {
      // \x1b is a real ESC byte at runtime, so the fetcher has actual ANSI to strip.
      const message = 'FAIL: expected 1 to equal 2\n\x1b[31mred text\x1b[0m';
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ message }]));
    } else {
      response.writeHead(404).end();
    }
  });
}

async function runFetch(scenario) {
  const server = fakeCircleCI(scenario);
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flake-fetch-'));
  const githubOutput = path.join(outDir, 'gh-output');
  fs.writeFileSync(githubOutput, '');

  const child = spawn(
    process.execPath,
    [
      FETCH,
      '--org',
      'acme',
      '--repo',
      'widget',
      '--branch',
      'master',
      '--out',
      path.join(outDir, 'data'),
    ],
    {
      env: {
        ...process.env,
        CIRCLECI_API_BASE: base,
        CIRCLECI_API_V1_BASE: base,
        CIRCLECI_APP_BASE: base,
        GITHUB_OUTPUT: githubOutput,
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
  const [code] = await once(child, 'exit');
  server.close();
  return {
    code,
    dataDir: path.join(outDir, 'data'),
    classify: fs.readFileSync(githubOutput, 'utf8').trim(),
  };
}

test('writes a per-job file with header and log tail when a job fails', async () => {
  const { code, dataDir, classify } = await runFetch('failing');
  assert.equal(code, 0);
  assert.equal(classify, 'classify=true');
  const jobFile = path.join(dataDir, 'jobs', '0000.txt');
  assert.ok(fs.existsSync(jobFile), 'expected jobs/0000.txt');
  const content = fs.readFileSync(jobFile, 'utf8');
  assert.match(content, /JOB=unit/);
  assert.match(content, /WORKFLOW=test/);
  assert.match(content, /STATUS=failed/);
  assert.match(content, /FAIL: expected 1 to equal 2/);
  assert.ok(!content.includes('\x1b['), 'ANSI codes should be stripped');
});

test('signals classify=false and writes no jobs when nothing failed', async () => {
  const { code, dataDir, classify } = await runFetch('clean');
  assert.equal(code, 0);
  assert.equal(classify, 'classify=false');
  assert.ok(!fs.existsSync(path.join(dataDir, 'jobs')), 'no jobs dir on a clean week');
});

test('signals classify=false when there are no pipelines', async () => {
  const { code, classify } = await runFetch('no-pipelines');
  assert.equal(code, 0);
  assert.equal(classify, 'classify=false');
});

test('signals classify=false when failed workflows have no failed jobs', async () => {
  const { code, classify } = await runFetch('no-failed-jobs');
  assert.equal(code, 0);
  assert.equal(classify, 'classify=false');
});
