// Offline test for the CircleCI fetcher. Stands up a fake CircleCI API, runs fetch.mjs against it
// as a subprocess, and asserts the per-job files, the timeline, and the classify signal.
//
// Run: pnpm test (this is a vitest project; see vitest.config.mts).

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FETCH = new URL('./fetch.mjs', import.meta.url).pathname;
const HOUR = 3_600_000;

const makeJob = (jobNumber, name, status) => ({ job_number: jobNumber, name, status });
const makeWorkflow = (id, name, status, createdAt, jobs) => ({ id, name, status, createdAt, jobs });
const makePipeline = (id, number, createdAt, subject, workflows) => ({
  id,
  number,
  createdAt,
  subject,
  workflows,
});

// Each scenario is plain data: which pipelines/workflows/jobs exist, and the log text per failed
// job number. The server below just serves it, so a test reads as the CI history it describes.
function scenarioModel(scenario) {
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();

  if (scenario === 'no-pipelines') {
    return { pipelines: [], logs: {} };
  }
  if (scenario === 'clean') {
    return {
      pipelines: [
        makePipeline('pipe-1', 100, iso(0), 'fix the thing', [
          makeWorkflow('wf-1', 'build', 'success', iso(0), [makeJob(5, 'lint', 'success')]),
        ]),
      ],
      logs: {},
    };
  }
  if (scenario === 'no-failed-jobs') {
    // The workflow is red but its only job passed — nothing to classify.
    return {
      pipelines: [
        makePipeline('pipe-1', 100, iso(0), 'fix the thing', [
          makeWorkflow('wf-1', 'test', 'failed', iso(0), [makeJob(5, 'lint', 'success')]),
        ]),
      ],
      logs: {},
    };
  }
  if (scenario === 'timeline') {
    // The `unit` job failed on two older commits, then passed on the newest — "already fixed".
    return {
      pipelines: [
        makePipeline('pipe-3', 102, iso(0), 'newest green', [
          makeWorkflow('wf-3', 'test', 'success', iso(0), [makeJob(72, 'unit', 'success')]),
        ]),
        makePipeline('pipe-2', 101, iso(HOUR), 'Bump zod #23515', [
          makeWorkflow('wf-2', 'test', 'failed', iso(HOUR), [makeJob(71, 'unit', 'failed')]),
        ]),
        makePipeline('pipe-1', 100, iso(2 * HOUR), 'Bump playwright #23507', [
          makeWorkflow('wf-1', 'test', 'failed', iso(2 * HOUR), [makeJob(70, 'unit', 'failed')]),
        ]),
      ],
      logs: { 70: 'MISSING_EXPORT "StyleSheetManager"', 71: 'MISSING_EXPORT "StyleSheetManager"' },
    };
  }
  // 'failing': one red run, one failed job.
  return {
    pipelines: [
      makePipeline('pipe-1', 100, iso(0), 'fix the thing', [
        makeWorkflow('wf-1', 'test', 'failed', iso(0), [makeJob(7, 'unit', 'failed')]),
      ]),
    ],
    logs: { 7: 'FAIL: expected 1 to equal 2\n\x1b[31mred text\x1b[0m' },
  };
}

// A tiny fake CircleCI: v2 pipelines/workflows/jobs, v1.1 job detail, and a log endpoint — all
// served from the scenario model. The handler writes a response on every branch and returns no
// value (consistent-return).
function fakeCircleCI(scenario) {
  const model = scenarioModel(scenario);
  const workflowsById = new Map();
  for (const pipeline of model.pipelines) {
    for (const workflow of pipeline.workflows) {
      workflowsById.set(workflow.id, workflow);
    }
  }
  return createServer((request, response) => {
    const url = request.url || '';
    const json = (payload) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    };

    if (url.startsWith('/project/') && url.includes('/pipeline?')) {
      json({
        items: model.pipelines.map((pipeline) => ({
          id: pipeline.id,
          number: pipeline.number,
          created_at: pipeline.createdAt,
          vcs: { commit: { subject: pipeline.subject } },
        })),
      });
      return;
    }
    const workflowMatch = url.match(/^\/pipeline\/([^/]+)\/workflow$/);
    if (workflowMatch) {
      const pipeline = model.pipelines.find((entry) => entry.id === workflowMatch[1]);
      json({
        items: (pipeline?.workflows ?? []).map((workflow) => ({
          id: workflow.id,
          name: workflow.name,
          status: workflow.status,
          created_at: workflow.createdAt,
        })),
      });
      return;
    }
    const jobMatch = url.match(/^\/workflow\/([^/]+)\/job$/);
    if (jobMatch) {
      const workflow = workflowsById.get(jobMatch[1]);
      json({ items: workflow?.jobs ?? [] });
      return;
    }
    const detailMatch = url.match(/^\/project\/[^/]+\/[^/]+\/[^/]+\/(\d+)$/);
    if (detailMatch) {
      const jobNumber = Number(detailMatch[1]);
      const hasLog = Object.prototype.hasOwnProperty.call(model.logs, jobNumber);
      const outputUrl = `http://127.0.0.1:${response.socket.localPort}/logs/${jobNumber}`;
      json({
        steps: hasLog
          ? [
              {
                name: 'run tests',
                actions: [{ failed: true, status: 'failed', output_url: outputUrl }],
              },
            ]
          : [],
      });
      return;
    }
    const logMatch = url.match(/^\/logs\/(\d+)$/);
    if (logMatch) {
      // \x1b is a real ESC byte at runtime, so the fetcher has actual ANSI to strip.
      const message = model.logs[Number(logMatch[1])] ?? '';
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ message }]));
      return;
    }
    response.writeHead(404).end();
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

describe('fetch', () => {
  it('writes a per-job file with header and log tail when a job fails', async () => {
    const { code, dataDir, classify } = await runFetch('failing');
    expect(code).toBe(0);
    expect(classify).toBe('classify=true');
    const content = fs.readFileSync(path.join(dataDir, 'jobs', '0000.txt'), 'utf8');
    expect(content).toMatch(/JOB=unit/);
    expect(content).toMatch(/WORKFLOW=test/);
    expect(content).toMatch(/STATUS=failed/);
    expect(content).toMatch(/FAIL: expected 1 to equal 2/);
    expect(content).not.toContain('\x1b[');
  });

  it('builds a timeline that shows passes, in time order, with log pointers to the failures', async () => {
    const { code, dataDir, classify } = await runFetch('timeline');
    expect(code).toBe(0);
    expect(classify).toBe('classify=true');
    const timeline = fs.readFileSync(path.join(dataDir, 'timeline.txt'), 'utf8');
    expect(timeline).toMatch(/## JOB=unit/);
    // The newest run passed; the two failures are older — this is the "already fixed" shape, and
    // the whole point is that the PASS is visible above the FAILs.
    expect(timeline).toMatch(
      /PASS {2}[^\n]*#102[\s\S]*FAIL {2}[^\n]*#101[\s\S]*FAIL {2}[^\n]*#100/,
    );
    expect(timeline).toContain('LOG=jobs/0000.txt');
    expect(timeline).toContain('LOG=jobs/0001.txt');
    // jobs/0000.txt is the newest failure (#101 / "Bump zod").
    const newest = fs.readFileSync(path.join(dataDir, 'jobs', '0000.txt'), 'utf8');
    expect(newest).toMatch(/COMMIT=Bump zod/);
    expect(newest).toMatch(/MISSING_EXPORT/);
  });

  it('signals classify=false and writes no jobs when nothing failed', async () => {
    const { code, dataDir, classify } = await runFetch('clean');
    expect(code).toBe(0);
    expect(classify).toBe('classify=false');
    expect(fs.existsSync(path.join(dataDir, 'jobs'))).toBe(false);
  });

  it('signals classify=false when there are no pipelines', async () => {
    const { code, classify } = await runFetch('no-pipelines');
    expect(code).toBe(0);
    expect(classify).toBe('classify=false');
  });

  it('signals classify=false when failed workflows have no failed jobs', async () => {
    const { code, classify } = await runFetch('no-failed-jobs');
    expect(code).toBe(0);
    expect(classify).toBe('classify=false');
  });
});
