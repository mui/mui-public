#!/usr/bin/env node
// Fetch recent CircleCI failure data for the flake-fix agent.
//
// Writes one text file per failed job into <out>/jobs/, each self-describing under grep, and
// signals `classify=<bool>` to $GITHUB_OUTPUT so the workflow can skip the (paid) agent when
// there is nothing to triage. This is the workflow-only fetcher: it takes an explicit project
// and never infers anything from a local checkout. The richer interactive tool it was distilled
// from is gone — this branch drops it deliberately (see the workflow's header).
//
// Deterministic and trusted: runs before the sandbox starts, so the CircleCI token stays on this
// side of the boundary and never enters the agent's environment.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, stripVTControlCharacters } from 'node:util';

// Base URLs are env-overridable so the test can point them at a local fake; production leaves
// them unset and hits CircleCI directly.
const API = process.env.CIRCLECI_API_BASE || 'https://circleci.com/api/v2';
const API_V1 = process.env.CIRCLECI_API_V1_BASE || 'https://circleci.com/api/v1.1';
const APP = process.env.CIRCLECI_APP_BASE || 'https://app.circleci.com';
const LOG_TAIL_BYTES = 4096;
const CONCURRENCY = 16;
// Job files are named 0000.txt, 0001.txt, …; the set is capped well under 10000, so four digits
// always suffice.
const PAD_WIDTH = 4;
const MAX_RETRIES = 3;
const BASE_RETRY_MS = 1000;

const inActions = process.env.GITHUB_ACTIONS === 'true';

function logLine(message) {
  console.error(message);
}

// GitHub Actions surfaces `::notice::`/`::warning::` lines in the run summary; elsewhere the
// prefix is just noise, so it is dropped while the message survives.
function logNotice(message) {
  logLine(inActions ? `::notice::${message}` : message);
}

function logWarning(message) {
  logLine(inActions ? `::warning::${message}` : `warning: ${message}`);
}

// Rate limits at this concurrency are expected and are not data loss — back off on 429 and retry.
async function httpGet(url, { token, raw = false, timeoutMs = 30000 } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) {
    headers['Circle-Token'] = token;
  }
  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      // eslint-disable-next-line no-await-in-loop -- retry loop
      response = await fetch(url, { headers, signal: controller.signal });
      if (response.ok) {
        // eslint-disable-next-line no-await-in-loop -- retry loop
        return raw ? await response.text() : await response.json();
      }
    } finally {
      clearTimeout(timer);
    }
    if (response.status !== 429 || attempt === MAX_RETRIES) {
      const error = new Error(`HTTP ${response.status} on ${url}`);
      error.status = response.status;
      throw error;
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    const delay =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : BASE_RETRY_MS * 2 ** attempt;
    // eslint-disable-next-line no-await-in-loop -- retry loop
    await new Promise((resolve) => {
      setTimeout(resolve, delay);
    });
  }
}

// Bounded-concurrency map: hundreds of calls that individually tolerate failure, so one 429 or
// 502 loses a single data point rather than the whole window.
async function mapPool(items, mapper, concurrency = CONCURRENCY) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) {
        return;
      }
      // eslint-disable-next-line no-await-in-loop -- worker drains the queue serially
      out[index] = await mapper(items[index], index);
    }
  }
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return out;
}

async function fetchPipelines(slug, branch, since, token) {
  const out = [];
  let pageToken = null;
  while (true) {
    let url = `${API}/project/${slug}/pipeline?branch=${encodeURIComponent(branch)}`;
    if (pageToken) {
      url += `&page-token=${encodeURIComponent(pageToken)}`;
    }
    // eslint-disable-next-line no-await-in-loop -- pagination is inherently sequential
    const data = await httpGet(url, { token });
    const items = data.items ?? [];
    if (items.length === 0) {
      break;
    }
    let reachedWindowEdge = false;
    for (const pipeline of items) {
      if (new Date(pipeline.created_at) < since) {
        reachedWindowEdge = true;
        break;
      }
      out.push(pipeline);
    }
    if (reachedWindowEdge || !data.next_page_token) {
      break;
    }
    pageToken = data.next_page_token;
  }
  return out;
}

function commitSubject(pipeline) {
  const commit = pipeline.vcs?.commit ?? {};
  if (commit.subject) {
    return commit.subject;
  }
  const message = pipeline.trigger_parameters?.git?.commit_message ?? '';
  return message.split('\n', 1)[0].slice(0, 120);
}

function tailBytes(text, limit) {
  return text.length <= limit ? text : text.slice(-limit);
}

// The one bit the workflow needs from us: whether anything is left to classify. Written to the
// step output so the agent step can gate on it with no shell glue.
function signalClassify(hasFailures) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `classify=${hasFailures}\n`);
  }
}

// One line the publish job can post to the tracking issue regardless of whether the agent ran —
// so a quiet or unclassifiable week still leaves a trail.
function writeSummary(outDir, line) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'summary.txt'), `${line}\n`);
}

function finishQuiet(outDir, summary) {
  logWarning(summary);
  writeSummary(outDir, summary);
  signalClassify(false);
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      org: { type: 'string' },
      repo: { type: 'string' },
      vcs: { type: 'string', default: 'github' },
      branch: { type: 'string', default: 'master' },
      days: { type: 'string', default: '7' },
      'max-workflows': { type: 'string', default: '40' },
      token: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (!args.org || !args.repo || !args.out) {
    logLine('error: --org, --repo and --out are required.');
    process.exit(2);
  }
  const { org, repo, vcs, branch } = args;
  const days = Number.parseInt(args.days, 10);
  // Caps the number of failed workflow *runs* analysed, not the job files (each run can hold
  // several failed jobs) — hence the name.
  const maxWorkflows = Number.parseInt(args['max-workflows'], 10);
  const outDir = args.out;
  const token = args.token || undefined;
  const slug = `${vcs === 'github' ? 'gh' : 'bb'}/${org}/${repo}`;
  const since = new Date(Date.now() - days * 86_400_000);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  logLine(`project: ${slug} | branch: ${branch} | window: ${days}d`);

  const pipelines = await fetchPipelines(slug, branch, since, token);
  if (pipelines.length === 0) {
    finishQuiet(outDir, `CircleCI triage: no pipelines on ${branch} in the last ${days}d.`);
    return;
  }

  // Failed-workflow statuses include `error`/`unauthorized`: a workflow that never ran its jobs
  // (broken config, permissions) is still a failed week, not a green one.
  const FAILED_WF_STATUSES = new Set(['failed', 'failing', 'error', 'unauthorized']);
  let dropped = 0;
  const workflowsByPipeline = await mapPool(pipelines, async (pipeline) => {
    try {
      const data = await httpGet(`${API}/pipeline/${pipeline.id}/workflow`, { token });
      return { pipeline, workflows: data.items ?? [] };
    } catch {
      dropped += 1;
      return { pipeline, workflows: [] };
    }
  });

  const allWorkflows = [];
  for (const { pipeline, workflows } of workflowsByPipeline) {
    for (const workflow of workflows) {
      allWorkflows.push({
        wfId: workflow.id,
        wfName: workflow.name,
        status: workflow.status,
        pipelineNumber: pipeline.number,
        createdAt: workflow.created_at,
        subject: commitSubject(pipeline),
      });
    }
  }
  const failedWorkflows = allWorkflows
    .filter((workflow) => FAILED_WF_STATUSES.has(workflow.status))
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));

  if (allWorkflows.length === 0 || failedWorkflows.length === 0) {
    finishQuiet(
      outDir,
      `CircleCI triage: clean (0/${allWorkflows.length} workflow runs failed on ${branch}).`,
    );
    return;
  }

  const analysed = failedWorkflows.slice(0, maxWorkflows);
  if (failedWorkflows.length > maxWorkflows) {
    logWarning(
      `Capping analysis at the ${maxWorkflows} most recent of ${failedWorkflows.length} failed runs.`,
    );
  }

  const jobsByWorkflow = await mapPool(analysed, async (workflow) => {
    try {
      const data = await httpGet(`${API}/workflow/${workflow.wfId}/job`, { token });
      const failed = (data.items ?? []).filter(
        (job) => job.status === 'failed' || job.status === 'timedout',
      );
      return { workflow, jobs: failed };
    } catch {
      dropped += 1;
      return { workflow, jobs: [] };
    }
  });

  const failedJobs = [];
  for (const { workflow, jobs } of jobsByWorkflow) {
    for (const job of jobs) {
      failedJobs.push({
        ...workflow,
        jobNumber: job.job_number,
        jobName: job.name,
        jobStatus: job.status,
      });
    }
  }
  if (failedJobs.length === 0) {
    finishQuiet(
      outDir,
      `CircleCI triage: ${failedWorkflows.length} failed workflow runs but no failed jobs found on ${branch}.`,
    );
    return;
  }

  // Per failed job, the v1.1 job API exposes each failed step's log URL.
  const stepsByJob = new Map(
    await mapPool(failedJobs, async (job) => {
      try {
        const data = await httpGet(`${API_V1}/project/${vcs}/${org}/${repo}/${job.jobNumber}`, {
          token,
        });
        const steps = [];
        let timedOut = false;
        for (const step of data.steps ?? []) {
          for (const action of step.actions ?? []) {
            if (action.status === 'timedout') {
              timedOut = true;
            }
            if (
              (action.failed || action.status === 'failed' || action.status === 'timedout') &&
              action.output_url
            ) {
              steps.push({ name: step.name, url: action.output_url });
            }
          }
        }
        return [job.jobNumber, { steps, timedOut }];
      } catch {
        return [job.jobNumber, { steps: [], timedOut: false }];
      }
    }),
  );

  const logTasks = [];
  for (const job of failedJobs) {
    stepsByJob.get(job.jobNumber).steps.forEach((step, stepIndex) => {
      logTasks.push({ jobNumber: job.jobNumber, stepIndex, ...step });
    });
  }
  if (logTasks.length === 0) {
    // Failed jobs exist but not one exposed a step log, so CircleCI's job API is not answering.
    // Classifying header-only text would call the whole corpus flake — refuse instead.
    finishQuiet(
      outDir,
      `CircleCI triage: ${failedJobs.length} failed jobs but no step logs available — CircleCI's job API is not answering.`,
    );
    return;
  }

  const logTexts = new Map();
  await mapPool(
    logTasks,
    async (task) => {
      let text = '';
      try {
        const raw = await httpGet(task.url, { raw: true, timeoutMs: 60000 });
        const joined = JSON.parse(raw)
          .map((entry) => entry.message ?? '')
          .join('');
        // Tail-truncate at fetch, not at read: whole logs would hold hundreds of MB alive across
        // a bad week, and only the tail is ever classified.
        text = tailBytes(stripVTControlCharacters(joined), LOG_TAIL_BYTES);
      } catch {
        text = '';
      }
      logTexts.set(`${task.jobNumber}:${task.stepIndex}`, text);
    },
    24,
  );

  fs.mkdirSync(path.join(outDir, 'jobs'), { recursive: true });
  failedJobs.forEach((job, jobIndex) => {
    const detail = stepsByJob.get(job.jobNumber);
    const body = detail.steps
      .map(
        (step, stepIndex) =>
          `### ${step.name}\n${logTexts.get(`${job.jobNumber}:${stepIndex}`) ?? ''}`,
      )
      .join('\n\n');
    // Each file carries its own metadata header, which is what makes it self-describing under grep.
    const header = [
      `INDEX=${jobIndex}`,
      `URL=${APP}/pipelines/${vcs}/${org}/${repo}/${job.pipelineNumber}/workflows/${job.wfId}`,
      `JOB=${job.jobName}`,
      `WORKFLOW=${job.wfName}`,
      `STATUS=${job.jobStatus}`,
      `TIMED_OUT=${detail.timedOut}`,
      `TIME=${job.createdAt}`,
      `COMMIT=${job.subject.replace(/\s+/g, ' ').slice(0, 200)}`,
      '',
      '',
    ].join('\n');
    fs.writeFileSync(
      path.join(outDir, 'jobs', `${String(jobIndex).padStart(PAD_WIDTH, '0')}.txt`),
      header + body,
    );
  });

  const failureRate = ((100 * failedWorkflows.length) / allWorkflows.length).toFixed(0);
  logNotice(
    `CircleCI triage: issues (${failedWorkflows.length}/${allWorkflows.length} workflow runs failed, ${failedJobs.length} failed jobs)`,
  );
  logLine(`wrote ${failedJobs.length} job files (${failureRate}% of runs failed)`);
  if (dropped > 0) {
    logWarning(
      `${dropped} CircleCI API calls failed and were skipped — this window is missing some data.`,
    );
  }
  signalClassify(true);
}

main().catch((error) => {
  logLine(`error: ${error.message}`);
  process.exit(1);
});
