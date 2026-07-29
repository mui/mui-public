#!/usr/bin/env node
// Fetch recent CircleCI failure data for LLM-based bucketing.
// Writes a fixed-size result.json verdict + one text file per failed job; LLM classifies with grep.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const API = 'https://circleci.com/api/v2';
const API_V1 = 'https://circleci.com/api/v1.1';
const APP = 'https://app.circleci.com';
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;
const LOG_TAIL_BYTES = 4096;

function log(...args) {
  console.error(...args);
}

// GitHub Actions reads `::notice::`/`::error::` on stderr and surfaces those lines in the run
// summary. Elsewhere the prefix is noise, so it is dropped — the message itself is not, which
// is why callers use these rather than deciding whether to speak at all.
const inActions = process.env.GITHUB_ACTIONS === 'true';

function logNotice(message) {
  log(inActions ? `::notice::${message}` : message);
}

function logWarning(message) {
  log(inActions ? `::warning::${message}` : `warning: ${message}`);
}

function logError(message) {
  log(inActions ? `::error::${message}` : `error: ${message}`);
}

async function httpGet(url, { token, raw = false, timeoutMs = 30000 } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) {
    headers['Circle-Token'] = token;
  }
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status} on ${url}`);
      err.status = r.status;
      throw err;
    }
    return raw ? await r.text() : await r.json();
  } finally {
    clearTimeout(tid);
  }
}

function gitOutput(args) {
  return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function inferRepo() {
  let url;
  try {
    url = gitOutput('remote get-url origin');
  } catch {
    return null;
  }
  const m = url.match(/(github\.com|bitbucket\.org)[:/]([^/]+)\/([^/.\s]+?)(?:\.git)?\/?$/);
  if (!m) {
    return null;
  }
  return {
    vcs: m[1].includes('github.com') ? 'github' : 'bitbucket',
    org: m[2],
    repo: m[3],
  };
}

function inferBranch() {
  try {
    const b = gitOutput('rev-parse --abbrev-ref HEAD');
    return b && b !== 'HEAD' ? b : null;
  } catch {
    return null;
  }
}

function loadTokenFromCliYml() {
  const p = path.join(os.homedir(), '.circleci', 'cli.yml');
  if (!fs.existsSync(p)) {
    return null;
  }
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*token:\s*(\S+)\s*$/);
    if (m && !m[1].startsWith('#')) {
      return m[1];
    }
  }
  return null;
}

function setupInstructions(slug) {
  return [
    '',
    `Cannot read CircleCI data for ${slug}. Project is private (or unreachable) and no valid token was found.`,
    '',
    'Install the CircleCI CLI:',
    '  macOS:  brew install circleci',
    '  Linux:  curl -fLSs https://raw.githubusercontent.com/CircleCI-Public/circleci-cli/main/install.sh | bash',
    '',
    'Then authenticate (writes ~/.circleci/cli.yml):',
    '  circleci setup',
    '',
    'After that, rerun this skill.',
    '',
  ].join('\n');
}

async function checkAccess(slug, token) {
  const probe = `${API}/project/${slug}/pipeline?branch=master`;
  try {
    await httpGet(probe);
    return { ok: true, token: null, mode: 'public' };
  } catch (err) {
    if (![401, 403, 404].includes(err.status)) {
      throw err;
    }
    if (!token) {
      return { ok: false, mode: `private (${err.status})` };
    }
    try {
      await httpGet(probe, { token });
      return { ok: true, token, mode: `private (${err.status}) + token` };
    } catch (err2) {
      return { ok: false, mode: `token rejected (${err2.status ?? '?'})` };
    }
  }
}

async function mapPool(items, fn, concurrency = 16) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= items.length) {
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      out[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
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
    // eslint-disable-next-line no-await-in-loop
    const data = await httpGet(url, { token });
    const items = data.items ?? [];
    if (items.length === 0) {
      break;
    }
    let stop = false;
    for (const p of items) {
      const created = new Date(p.created_at);
      if (created < since) {
        stop = true;
        break;
      }
      out.push(p);
    }
    if (stop) {
      break;
    }
    pageToken = data.next_page_token;
    if (!pageToken) {
      break;
    }
  }
  return out;
}

function commitSubject(p) {
  const v = p.vcs?.commit ?? {};
  if (v.subject) {
    return v.subject;
  }
  const msg = p.trigger_parameters?.git?.commit_message ?? '';
  return msg.split('\n', 1)[0].slice(0, 120);
}

function workflowUrl({ vcs, org, repo, pipelineNumber, wfId }) {
  return `${APP}/pipelines/${vcs}/${org}/${repo}/${pipelineNumber}/workflows/${wfId}`;
}

function tailBytes(s, n) {
  if (s.length <= n) {
    return s;
  }
  return s.slice(-n);
}

/**
 * What the run found, as data rather than prose. The finished report, when there is one, is
 * written next to this as `report.md`.
 *
 *   {
 *     status: 'issues' | 'clean' | 'no-job-failures' | 'no-data',
 *     project, branch, days,
 *     totals: { workflows, failedWorkflows, failureRatePct, failedJobs },
 *   }
 *
 * Nothing parses it — a caller learns what to do from the `classify` step output written
 * alongside it, and reads the report from `report.md`. It exists so a reader (usually a model)
 * can see what the window looked like.
 *
 * Deliberately fixed-size: it carries counts, never a per-failure list. The failures live in
 * `jobs/*.txt`, which are meant to be discovered with `grep` rather than read in bulk, so a
 * week with 500 failures costs a reader no more context here than a week with five.
 */
function writeResult(outDir, result) {
  fs.writeFileSync(path.join(outDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  announce(result);
}

/**
 * Announce the verdict, and hand a caller in GitHub Actions the one bit it needs — whether
 * there is anything left to classify — so its step needs no shell glue to read result.json.
 */
function announce(result) {
  const { workflows, failedWorkflows, failedJobs } = result.totals;
  const line = `CircleCI triage: ${result.status} (${failedWorkflows}/${workflows} workflow runs failed, ${failedJobs} failed jobs)`;
  // `no-data` means the triage looked at nothing and `no-job-failures` points at CircleCI
  // itself. Both exit 0 and both need a human eventually, so they must not read as a green
  // run in the Actions UI the way `clean` and `issues` legitimately do.
  if (result.status === 'no-data' || result.status === 'no-job-failures') {
    logWarning(line);
  } else {
    logNotice(line);
  }
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `classify=${result.status === 'issues'}\n`);
  }
}

function totalsOf({ slug, branch, days, totalWfs, failedWfs, failedJobs, analysedWfs }) {
  return {
    project: slug,
    branch,
    days,
    totals: {
      workflows: totalWfs,
      failedWorkflows: failedWfs,
      failureRatePct: totalWfs === 0 ? 0 : Number(((100 * failedWfs) / totalWfs).toFixed(1)),
      failedJobs,
      // How many of the failed workflows were actually opened. Below failedWorkflows when
      // --max truncated the run, which is the only way a reader can tell that failedJobs
      // counts a slice rather than the window — the cap otherwise only shows up on stderr.
      analysedWorkflows: analysedWfs ?? failedWfs,
    },
  };
}

/**
 * Why a run ended with nothing to classify. The caller states which case it is rather than
 * letting this infer it from the counts: several distinct situations produce the same zeroes,
 * and guessing between them published confident, wrong diagnoses.
 */
const NO_WORK = {
  'no-pipelines': {
    status: 'no-data',
    note: 'No pipelines ran on this branch in this window. Either nothing was pushed, or the triage is pointed at the wrong place — check the branch name and that the project still builds on CircleCI.',
  },
  'no-workflows': {
    status: 'no-data',
    note: 'Pipelines ran, but none of them produced a workflow — they failed before CircleCI got that far, which usually means the config could not be processed.',
  },
  'no-matching-workflow': {
    status: 'no-data',
    note: 'Pipelines ran, but none contained a workflow by the name that was asked for. Check that name — the triage looked at nothing.',
  },
  'nothing-failed': {
    status: 'clean',
    note: 'CI was green over this window. Nothing to triage.',
  },
  'no-failed-jobs': {
    status: 'no-job-failures',
    note: 'Those runs exposed no failed job, so there is nothing to bucket: their jobs ended in states CircleCI does not report as failures (infrastructure_fail, canceled, not_run). That points at CircleCI itself rather than at a flaky test.',
  },
  'nothing-analysed': {
    status: 'no-job-failures',
    note: 'Workflows failed, but none of them were analysed — the cap on how many to look at left nothing. Raise --max.',
  },
};

/**
 * Finish a run that produced no failed jobs, and so has nothing to classify. Writes the
 * finished report itself: only this script knows which of the no-work cases it is.
 */
function finishWithoutFailedJobs(outDir, { slug, branch, days, totalWfs, failedWfs, reason }) {
  const base = totalsOf({ slug, branch, days, totalWfs, failedWfs, failedJobs: 0 });
  const { status, note } = NO_WORK[reason];

  const report = [
    `# ${slug} \`${branch}\` — last ${days} days`,
    '',
    `**${failedWfs}/${totalWfs}** workflow runs failed (${base.totals.failureRatePct}% failure rate). **0** failed jobs to classify.`,
    '',
    note,
    '',
  ].join('\n');

  // `report.md` is the one path a consumer needs, whether the report came from here or from
  // the classifier afterwards.
  fs.writeFileSync(path.join(outDir, 'report.md'), report);
  writeResult(outDir, { status, ...base });
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      org: { type: 'string' },
      repo: { type: 'string' },
      vcs: { type: 'string' },
      branch: { type: 'string' },
      workflow: { type: 'string' },
      days: { type: 'string', default: '7' },
      max: { type: 'string', default: '200' },
      token: { type: 'string' },
      out: { type: 'string' },
      'cache-dir': { type: 'string' },
    },
  });
  const days = Number.parseInt(args.days, 10);
  const maxJobs = Number.parseInt(args.max, 10);
  if (!args.out) {
    console.error('error: --out <dir> is required.');
    console.error(
      '       Example: mkdir -p .claude/cache && OUT=$(mktemp -d .claude/cache/cci-flake.XXXXXX) && node fetch.mjs --out "$OUT"',
    );
    process.exit(2);
  }
  const outDir = args.out;
  const cacheDir = args['cache-dir'] ?? '.claude/cache/circleci-why-flaky-cache';

  let { vcs, org, repo } = args;
  if (!(vcs && org && repo)) {
    const inferred = inferRepo();
    if (!inferred) {
      console.error('error: cannot infer repo from `git remote get-url origin`.');
      console.error('       Pass --org, --repo, and --vcs explicitly.');
      process.exit(2);
    }
    vcs ??= inferred.vcs;
    org ??= inferred.org;
    repo ??= inferred.repo;
  }
  const branch = args.branch ?? inferBranch() ?? 'master';
  // `||`, not `??`: a caller passing an empty --token (an unset CI secret) means "no
  // token", and should still fall back to ~/.circleci/cli.yml rather than be stuck with ''.
  const token = args.token || loadTokenFromCliYml();
  const slug = `${vcs === 'github' ? 'gh' : 'bb'}/${org}/${repo}`;

  const access = await checkAccess(slug, token);
  if (!access.ok) {
    console.error(setupInstructions(slug));
    logError(`Cannot read CircleCI data for ${slug} — it is private and no valid token was found.`);
    process.exit(3);
  }
  const useToken = access.token;
  const since = new Date(Date.now() - days * 86_400_000);

  // Reset output directory; preserve cross-run log cache for speed.
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true }); // `jobs/` is created later, only if it gets files
  fs.mkdirSync(cacheDir, { recursive: true });

  log(`project: ${slug} | branch: ${branch} | window: ${days}d | access: ${access.mode}`);

  let t = Date.now();
  log(`fetching pipelines on ${branch} since ${since.toISOString().slice(0, 10)}...`);
  const pipelines = await fetchPipelines(slug, branch, since, useToken);
  log(`  ${pipelines.length} pipelines  (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  if (pipelines.length === 0) {
    finishWithoutFailedJobs(outDir, {
      slug,
      branch,
      days,
      totalWfs: 0,
      failedWfs: 0,
      reason: 'no-pipelines',
    });
    // eslint-disable-next-line no-console -- stdout is the script's contract: prints output dir for shell capture
    console.log(outDir);
    return;
  }

  t = Date.now();
  log('fetching workflows...');
  // Individually tolerant: hundreds of calls at concurrency 16 will occasionally draw a 429 or
  // a 502, and losing the whole week to one of them is worse than analysing slightly less of
  // it. `dropped` is reported so a run that lost a lot of data says so.
  let dropped = 0;
  const wfsPerPipe = await mapPool(
    pipelines,
    async (p) => {
      try {
        const d = await httpGet(`${API}/pipeline/${p.id}/workflow`, { token: useToken });
        return { pipelineId: p.id, wfs: d.items ?? [] };
      } catch {
        dropped += 1;
        return { pipelineId: p.id, wfs: [] };
      }
    },
    16,
  );
  log(`  done (${((Date.now() - t) / 1000).toFixed(1)}s)`);

  const pipeById = new Map(pipelines.map((p) => [p.id, p]));
  const allWfs = [];
  for (const { pipelineId, wfs } of wfsPerPipe) {
    const p = pipeById.get(pipelineId);
    for (const w of wfs) {
      if (args.workflow && w.name !== args.workflow) {
        continue;
      }
      allWfs.push({
        wfId: w.id,
        wfName: w.name,
        status: w.status,
        pipelineNumber: p.number,
        createdAt: w.created_at,
        subject: commitSubject(p),
      });
    }
  }
  // `error` and `unauthorized` are CircleCI's statuses for a workflow that never got to run
  // its jobs — a broken config, or a permissions problem. Leaving them out reported a week in
  // which CI never ran at all as green.
  const FAILED_WF_STATUSES = new Set(['failed', 'failing', 'error', 'unauthorized']);
  const failedWfs = allWfs.filter((w) => FAILED_WF_STATUSES.has(w.status));
  const totalWfs = allWfs.length;
  if (totalWfs === 0) {
    const target = args.workflow ? `workflow '${args.workflow}'` : 'any workflow';
    log(`No ${target} runs on '${branch}' in the last ${days} days.`);
    finishWithoutFailedJobs(outDir, {
      slug,
      branch,
      days,
      totalWfs: 0,
      failedWfs: 0,
      reason: args.workflow ? 'no-matching-workflow' : 'no-workflows',
    });
    // eslint-disable-next-line no-console -- stdout is the script's contract: prints output dir for shell capture
    console.log(outDir);
    return;
  }

  const wfCounts = new Map();
  for (const w of allWfs) {
    wfCounts.set(w.wfName, (wfCounts.get(w.wfName) ?? 0) + 1);
  }
  if (!args.workflow) {
    const list = [...wfCounts.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}=${c}`);
    log(`  workflows: ${list.join(', ')}`);
  }
  const failureRate = (100 * failedWfs.length) / totalWfs;
  log(`  failed: ${failedWfs.length}/${totalWfs} (${failureRate.toFixed(1)}%)`);
  if (failedWfs.length === 0) {
    finishWithoutFailedJobs(outDir, {
      slug,
      branch,
      days,
      totalWfs,
      failedWfs: 0,
      reason: 'nothing-failed',
    });
    // eslint-disable-next-line no-console -- stdout is the script's contract: prints output dir for shell capture
    console.log(outDir);
    return;
  }

  failedWfs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  let capped = failedWfs;
  if (failedWfs.length > maxJobs) {
    log(`  capping deep analysis at ${maxJobs} (most recent)`);
    capped = failedWfs.slice(0, maxJobs);
  }

  t = Date.now();
  log('fetching failed jobs...');
  const jobsPerWf = await mapPool(
    capped,
    async (w) => {
      try {
        const d = await httpGet(`${API}/workflow/${w.wfId}/job`, { token: useToken });
        const failed = (d.items ?? []).filter(
          (j) => j.status === 'failed' || j.status === 'timedout',
        );
        return { wfId: w.wfId, jobs: failed };
      } catch {
        dropped += 1;
        return { wfId: w.wfId, jobs: [] };
      }
    },
    16,
  );
  log(`  done (${((Date.now() - t) / 1000).toFixed(1)}s)`);

  const wfById = new Map(capped.map((w) => [w.wfId, w]));
  const failedJobs = [];
  for (const { wfId, jobs } of jobsPerWf) {
    const w = wfById.get(wfId);
    for (const j of jobs) {
      failedJobs.push({
        ...w,
        jobNumber: j.job_number,
        jobName: j.name,
        jobStatus: j.status,
      });
    }
  }
  log(`  ${failedJobs.length} failed jobs`);
  if (failedJobs.length === 0) {
    finishWithoutFailedJobs(outDir, {
      slug,
      branch,
      days,
      totalWfs,
      failedWfs: failedWfs.length,
      reason: capped.length === 0 ? 'nothing-analysed' : 'no-failed-jobs',
    });
    // eslint-disable-next-line no-console -- stdout is the script's contract: prints output dir for shell capture
    console.log(outDir);
    return;
  }

  t = Date.now();
  log('fetching job step details...');
  const detailsByJob = new Map(
    await mapPool(
      failedJobs,
      async (j) => {
        let d;
        try {
          d = await httpGet(`${API_V1}/project/${vcs}/${org}/${repo}/${j.jobNumber}`, {
            token: useToken,
          });
        } catch {
          return [j.jobNumber, { steps: [], timedOut: false }];
        }
        const out = { steps: [], timedOut: false };
        for (const s of d.steps ?? []) {
          for (const a of s.actions ?? []) {
            if (a.status === 'timedout') {
              out.timedOut = true;
            }
            if (a.failed || a.status === 'failed' || a.status === 'timedout') {
              if (a.output_url) {
                out.steps.push({ name: s.name, url: a.output_url });
              }
            }
          }
        }
        return [j.jobNumber, out];
      },
      16,
    ),
  );
  log(`  done (${((Date.now() - t) / 1000).toFixed(1)}s)`);

  t = Date.now();
  log('downloading step logs...');
  const tasks = [];
  for (const j of failedJobs) {
    const det = detailsByJob.get(j.jobNumber);
    det.steps.forEach((s, i) => tasks.push({ jobNumber: j.jobNumber, idx: i, ...s }));
  }
  const logTexts = new Map();
  await mapPool(
    tasks,
    async (task) => {
      const cachePath = path.join(cacheDir, `${task.jobNumber}_${task.idx}.txt`);
      let text = '';
      if (fs.existsSync(cachePath)) {
        try {
          text = fs.readFileSync(cachePath, 'utf8');
        } catch {
          /* ignore */
        }
      }
      if (!text) {
        try {
          const raw = await httpGet(task.url, { raw: true, timeoutMs: 60000 });
          const messages = JSON.parse(raw)
            .map((m) => m.message ?? '')
            .join('');
          text = messages.replace(ANSI_RE, '');
          try {
            fs.writeFileSync(cachePath, tailBytes(text, 200_000));
          } catch {
            /* ignore */
          }
        } catch {
          text = '';
        }
      }
      logTexts.set(`${task.jobNumber}:${task.idx}`, text);
    },
    24,
  );
  log(`  ${tasks.length} step logs (${((Date.now() - t) / 1000).toFixed(1)}s)`);

  fs.mkdirSync(path.join(outDir, 'jobs'), { recursive: true }); // only once there are jobs in it
  let withLogs = 0; // job files that got actual log text, not just a header
  const padWidth = Math.max(4, String(Math.max(failedJobs.length - 1, 0)).length);
  // Each file carries its own metadata header, which is what makes it self-describing under
  // `grep` — and why result.json does not repeat the same list at O(corpus) size.
  failedJobs.forEach((j, i) => {
    const det = detailsByJob.get(j.jobNumber);
    const parts = det.steps.map((s, k) => {
      const txt = logTexts.get(`${j.jobNumber}:${k}`) ?? '';
      return `### ${s.name}\n${tailBytes(txt, LOG_TAIL_BYTES)}`;
    });
    const record = {
      file: path.join('jobs', `${String(i).padStart(padWidth, '0')}.txt`),
      url: workflowUrl({ vcs, org, repo, pipelineNumber: j.pipelineNumber, wfId: j.wfId }),
      job: j.jobName,
      workflow: j.wfName,
      status: j.jobStatus,
      timedOut: det.timedOut,
      time: j.createdAt,
      commit: j.subject.replace(/\s+/g, ' ').slice(0, 200),
    };
    const header = [
      `INDEX=${i}`,
      `URL=${record.url}`,
      `JOB=${record.job}`,
      `WORKFLOW=${record.workflow}`,
      `STATUS=${record.status}`,
      `TIMED_OUT=${record.timedOut}`,
      `TIME=${record.time}`,
      `COMMIT=${record.commit}`,
      '',
      '',
    ].join('\n');
    if (parts.length > 0) {
      withLogs += 1;
    }
    fs.writeFileSync(path.join(outDir, record.file), header + parts.join('\n\n'));
  });

  writeResult(outDir, {
    status: 'issues',
    ...totalsOf({
      slug,
      branch,
      days,
      totalWfs,
      failedWfs: failedWfs.length,
      failedJobs: failedJobs.length,
      analysedWfs: capped.length,
    }),
  });
  log(`wrote ${failedJobs.length} job files to ${path.join(outDir, 'jobs')}/`);
  if (withLogs === 0) {
    // Every job file is a bare header: the step-detail or log fetches all failed. Classifying
    // that would bucket the week by job name and call it flake, so refuse rather than publish
    // a confident report drawn from no log text at all.
    logError(
      `Fetched ${failedJobs.length} failed jobs but could not read a single log — CircleCI's job API is not answering. Nothing here is classifiable.`,
    );
    process.exit(4);
  }
  if (dropped > 0) {
    logWarning(
      `${dropped} CircleCI API calls failed and were skipped — this window is missing some of its data.`,
    );
  }
  // eslint-disable-next-line no-console -- stdout is the script's contract: prints output dir for shell capture
  console.log(outDir);
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
