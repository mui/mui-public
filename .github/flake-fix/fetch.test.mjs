// Offline test for the CircleCI fetcher. Stands up a fake CircleCI API, runs fetch.mjs against it
// as a subprocess, and asserts the per-job files, the timeline, and the classify signal.
//
// Run: pnpm test (this is a vitest project; see vitest.config.mts).

import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FETCH = new URL('./fetch.mjs', import.meta.url).pathname;
const HOUR = 3_600_000;
const execFileAsync = promisify(execFile);

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
  // `null` workflows or jobs make the fake answer 404, as CircleCI does for a call without a token.
  if (scenario === 'workflows-unreachable') {
    return {
      pipelines: [
        makePipeline('pipe-2', 101, iso(0), 'second', null),
        makePipeline('pipe-1', 100, iso(HOUR), 'first', null),
      ],
      logs: {},
    };
  }
  if (scenario === 'some-workflows-unreachable') {
    return {
      pipelines: [
        makePipeline('pipe-2', 101, iso(0), 'second', null),
        makePipeline('pipe-1', 100, iso(HOUR), 'first', [
          makeWorkflow('wf-1', 'build', 'success', iso(HOUR), [makeJob(5, 'lint', 'success')]),
        ]),
      ],
      logs: {},
    };
  }
  if (scenario === 'jobs-unreachable') {
    return {
      pipelines: [
        makePipeline('pipe-1', 100, iso(0), 'fix the thing', [
          makeWorkflow('wf-1', 'test', 'failed', iso(0), null),
        ]),
      ],
      logs: {},
    };
  }
  if (scenario === 'partial-workflows' || scenario === 'partial-jobs') {
    return {
      pipelines: [
        makePipeline(
          'pipe-2',
          101,
          iso(0),
          'newest run unavailable',
          scenario === 'partial-workflows'
            ? null
            : [makeWorkflow('wf-2', 'test', 'success', iso(0), null)],
        ),
        makePipeline('pipe-1', 100, iso(HOUR), 'older failure', [
          makeWorkflow('wf-1', 'test', 'failed', iso(HOUR), [makeJob(7, 'unit', 'failed')]),
        ]),
      ],
      logs: { 7: 'FAIL: expected 1 to equal 2' },
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
// served from the scenario model. The handler writes a response on every branch and returns nothing.
function fakeCircleCI(scenario) {
  const model = scenarioModel(scenario);
  const workflowsById = new Map();
  for (const pipeline of model.pipelines) {
    for (const workflow of pipeline.workflows ?? []) {
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
      if (pipeline?.workflows === null) {
        response.writeHead(404).end();
        return;
      }
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
      if (workflow?.jobs === null) {
        response.writeHead(404).end();
        return;
      }
      json({ items: workflow?.jobs ?? [] });
      return;
    }
    const detailMatch = url.match(/^\/project\/[^/]+\/[^/]+\/[^/]+\/(\d+)$/);
    if (detailMatch) {
      const jobNumber = Number(detailMatch[1]);
      const hasLog = Object.hasOwn(model.logs, jobNumber);
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

async function runPublish(dataDir) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'flake-publish-'));
  try {
    fs.cpSync(dataDir, path.join(workspace, 'publish-input'), { recursive: true });
    const stepSummary = path.join(workspace, 'step-summary.md');
    fs.writeFileSync(stepSummary, '');

    // Execute the actual final github-script step with the real Actions summary writer. Its
    // dry-run path renders the same comment as publication without making GitHub API calls.
    const workflow = fs.readFileSync(
      new URL('../workflows/claude-flake-fix.yml', import.meta.url),
      'utf8',
    );
    const reportStep = workflow.split('      - name: Post the report to the tracking issue\n')[1];
    const script = reportStep.split('          script: |\n')[1].replace(/^ {12}/gm, '');
    await execFileAsync(
      process.execPath,
      [
        '-e',
        `(async () => {
          const core = await import('@actions/core');
          ${script}
        })().catch((error) => {
          console.error(error);
          process.exitCode = 1;
        });`,
      ],
      {
        cwd: new URL('../../', import.meta.url),
        env: {
          ...process.env,
          GITHUB_WORKSPACE: workspace,
          GITHUB_STEP_SUMMARY: stepSummary,
          DRY_RUN: 'true',
          PR_URL: '',
          FIX_COMMIT: '',
          RUN_URL: 'https://github.com/acme/widget/actions/runs/1',
        },
      },
    );
    return fs.readFileSync(stepSummary, 'utf8');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
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

  it('builds a timeline.json that shows passes, in time order, with log pointers to the failures', async () => {
    const { code, dataDir, classify } = await runFetch('timeline');
    expect(code).toBe(0);
    expect(classify).toBe('classify=true');
    const timeline = JSON.parse(fs.readFileSync(path.join(dataDir, 'timeline.json'), 'utf8'));
    const unit = timeline.jobs.find((job) => job.job === 'unit');
    expect(unit.workflow).toBe('test');
    // The newest run passed; the two failures are older — the "already fixed" shape. The whole
    // point is that the PASS is present, newest first, alongside the failures.
    expect(unit.runs.map((run) => run.result)).toEqual(['PASS', 'FAIL', 'FAIL']);
    expect(unit.runs.map((run) => run.pipeline)).toEqual([102, 101, 100]);
    expect(unit.runs[0].log).toBe(null);
    expect(unit.runs[1].log).toBe('jobs/0000.txt');
    expect(unit.runs[2].log).toBe('jobs/0001.txt');
    // jobs/0000.txt is the newest failure (#101 / "Bump zod").
    const newest = fs.readFileSync(path.join(dataDir, 'jobs', '0000.txt'), 'utf8');
    expect(newest).toMatch(/COMMIT=Bump zod/);
    expect(newest).toMatch(/MISSING_EXPORT/);
    // A CircleCI Insights link for the busiest failing workflow, for the dashboard footer.
    const insights = fs.readFileSync(path.join(dataDir, 'insights.txt'), 'utf8').trim();
    expect(insights).toContain('/insights/github/acme/widget/workflows/test/overview');
    expect(insights).toContain('branch=master');
    expect(insights).toContain('reporting-window=last-7-days');
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

  it('reports no data, not clean, when no workflow list loads', async () => {
    const { code, dataDir, classify } = await runFetch('workflows-unreachable');
    expect(code).toBe(0);
    expect(classify).toBe('classify=false');
    const summary = fs.readFileSync(path.join(dataDir, 'summary.txt'), 'utf8');
    expect(summary).toMatch(/no data/);
    expect(summary).not.toMatch(/clean/);
    expect(summary).toMatch(/HTTP 404 on \S+\/pipeline\/pipe-\d\/workflow/);
  });

  it('does not report clean when some workflow lists fail to load', async () => {
    const { code, dataDir, classify } = await runFetch('some-workflows-unreachable');
    expect(code).toBe(0);
    expect(classify).toBe('classify=false');
    const summary = fs.readFileSync(path.join(dataDir, 'summary.txt'), 'utf8');
    expect(summary).not.toMatch(/clean/);
    expect(summary).toMatch(/HTTP 404 on \S+\/pipeline\/pipe-2\/workflow/);
  });

  it('names the failed call when the job lists fail to load', async () => {
    const { code, dataDir, classify } = await runFetch('jobs-unreachable');
    expect(code).toBe(0);
    expect(classify).toBe('classify=false');
    const summary = fs.readFileSync(path.join(dataDir, 'summary.txt'), 'utf8');
    expect(summary).toMatch(/HTTP 404 on \S+\/workflow\/wf-1\/job/);
  });

  it.each([
    ['partial-workflows', /HTTP 404 on \S+\/pipeline\/pipe-2\/workflow/],
    ['partial-jobs', /HTTP 404 on \S+\/workflow\/wf-2\/job/],
  ])(
    'publishes missing-data diagnostics alongside an agent report (%s)',
    async (scenario, error) => {
      const { code, dataDir, classify } = await runFetch(scenario);
      expect(code).toBe(0);
      expect(classify).toBe('classify=true');
      expect(fs.readFileSync(path.join(dataDir, 'jobs', '0000.txt'), 'utf8')).toContain(
        'FAIL: expected 1 to equal 2',
      );
      const agentReport = 'The unit test is still failing.';
      const fallbackSummary = 'Fallback summary that the agent report supersedes.';
      fs.writeFileSync(path.join(dataDir, 'report.md'), agentReport);
      fs.writeFileSync(path.join(dataDir, 'summary.txt'), fallbackSummary);

      const published = await runPublish(dataDir);
      expect(published).toContain(agentReport);
      expect(published).not.toContain(fallbackSummary);
      expect(published).toContain('1 CircleCI API calls failed, so data is missing');
      expect(published).toMatch(error);
    },
  );
});
