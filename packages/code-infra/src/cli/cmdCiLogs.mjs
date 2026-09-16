#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { createActionAuth } from '@octokit/auth-action';
import { Octokit } from '@octokit/rest';
import envCI from 'env-ci';

import { persistentAuthStrategy } from '../utils/github.mjs';

const isCI = envCI().isCi;

/** @type {readonly ['netlify', 'circleci', 'gh-action']} */
const SERVICES = ['netlify', 'circleci', 'gh-action'];

/** @typedef {(typeof SERVICES)[number]} CiService */

/**
 * @typedef {Object} CiLogsArgs
 * @property {CiService} service
 * @property {string} repository
 * @property {string} job
 * @property {string} [output]
 * @property {string} [head]
 */

/** @typedef {{steps?: Array<{name?: string, actions?: Array<{failed?: boolean, status?: string, output_url?: string}>}>}} CircleJob */
/** @typedef {{message?: string}} CircleLogMessage */

/**
 * Fetch provider JSON with a bounded network timeout.
 * @param {string|URL} url
 * @param {Record<string, string>} headers
 * @param {'circleci'|'netlify'} [service]
 */
async function readJson(url, headers, service) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const hint =
      [401, 403, 404].includes(response.status) &&
      !process.env.CIRCLE_TOKEN &&
      !process.env.CIRCLECI_TOKEN &&
      service === 'circleci'
        ? ' The project may be private; set CIRCLE_TOKEN to a CircleCI personal API token.'
        : '';
    throw new Error(`CI log request failed: HTTP ${response.status}.${hint}`);
  }
  return response.json();
}

/**
 * Retrieve a finished deployment's logs after verifying the inspected PR head.
 * @param {string} deployId
 * @param {string} head
 */
async function fetchNetlifyLogs(deployId, head) {
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_ACCESS_CONTROL_TOKEN;
  const deploy = await readNetlifyJson(
    `https://api.netlify.com/api/v1/deploys/${deployId}`,
    token,
    'deployment metadata request',
  );
  if (deploy.id !== deployId || !deploy.site_id || deploy.commit_ref !== head) {
    throw new Error('Netlify deployment does not match the inspected head or lacks site metadata');
  }
  if (!['error', 'ready', 'rejected'].includes(deploy.state)) {
    throw new Error(`Netlify deployment is not finished (state: ${deploy.state})`);
  }
  const url = new URL('https://app.netlify.com/access-control/generate-access-control-token');
  url.search = new URLSearchParams({ deploy_id: deployId, site_id: deploy.site_id }).toString();
  const { accessControlToken } = await readNetlifyJson(
    url,
    token || 'undefined',
    'access-control token request',
  );
  if (typeof accessControlToken !== 'string' || !accessControlToken) {
    throw new Error('Netlify access-control token response lacks a token');
  }
  return {
    ...(await readDeploySocket({
      deploy_id: deployId,
      site_id: deploy.site_id,
      access_token: accessControlToken,
    })),
    evidence: {
      deployId,
      siteId: deploy.site_id,
      head: deploy.commit_ref,
      state: deploy.state,
    },
  };
}

/**
 * Fetch Netlify JSON without exposing credentials or response bodies in errors.
 * @param {string|URL} url
 * @param {string|undefined} token
 * @param {string} label
 */
async function readNetlifyJson(url, token, label) {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  });
  if (!response.ok) {
    throw new Error(`Netlify ${label} failed: HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`Netlify ${label} returned invalid JSON`);
  }
}

/**
 * Read the external log stream, bounded by total time and inactivity after log messages.
 * @param {{deploy_id: string, site_id: string, access_token: string}} payload
 * @returns {Promise<{log: string, endedBy: string|undefined}>}
 */
function readDeploySocket(payload) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket('wss://socketeer.services.netlify.com/build/logs');
    /** @type {string[]} */
    const lines = [];
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let idleTimer;
    let settled = false;
    const deadline = setTimeout(() => finish(new Error('Netlify log stream timed out')), 30_000);

    /** @param {Error|undefined} error @param {string|undefined} [endedBy] */
    function finish(error, endedBy) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      clearTimeout(idleTimer);
      socket.close();
      const log = lines.join('\n');
      if (error || !log.trim()) {
        reject(error ?? new Error('Netlify log stream returned no log content'));
      } else {
        resolve({ log, endedBy });
      }
    }

    socket.addEventListener('open', () => socket.send(JSON.stringify(payload)));
    socket.addEventListener('error', () =>
      finish(new Error('Netlify log WebSocket connection failed')),
    );
    socket.addEventListener('close', (event) => {
      finish(
        event.code === 1000 ? undefined : new Error(`Netlify log WebSocket closed: ${event.code}`),
        'socket-close',
      );
    });
    socket.addEventListener('message', (event) => {
      if (settled) {
        return;
      }
      /** @type {{type?: string, message?: string}} */
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        finish(new Error('Netlify log stream returned invalid JSON'));
        return;
      }
      if (!data || typeof data !== 'object' || data.type === 'error') {
        finish(new Error('Netlify log stream returned an error response'));
        return;
      }
      if (typeof data.message !== 'string' || !data.message.trim()) {
        return;
      }
      lines.push(data.message);
      if (data.message.startsWith('Finished processing build request in ')) {
        finish(undefined, 'build-finished');
        return;
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(undefined, 'idle-timeout'), 5_000);
    });
  });
}

/**
 * Fetch CI logs from one supported service.
 * @param {CiService} service
 * @param {string} repository
 * @param {string} job
 * @param {string|undefined} head
 * @returns {Promise<{log: string, evidence?: Record<string, string>}>}
 */
async function fetchCiLogs(service, repository, job, head) {
  if (service === 'gh-action') {
    const [owner, repo] = repository.split('/');
    const octokit = new Octokit({
      authStrategy: isCI ? createActionAuth : persistentAuthStrategy,
    });
    const result = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
      owner,
      repo,
      job_id: Number(job),
    });
    if (typeof result.data !== 'string') {
      throw new Error('GitHub Actions log response was not text.');
    }
    return { log: result.data };
  }
  if (service === 'netlify') {
    if (!head) {
      throw new Error('A 40-character --head SHA is required for Netlify logs.');
    }
    return fetchNetlifyLogs(job, head);
  }

  const circleToken = process.env.CIRCLE_TOKEN || process.env.CIRCLECI_TOKEN || '';
  /** @type {CircleJob} */
  const data = await readJson(
    `https://circleci.com/api/v1.1/project/github/${repository}/${job}`,
    circleToken ? { 'Circle-Token': circleToken } : {},
    'circleci',
  );
  const actions = (data.steps ?? []).flatMap((step) =>
    (step.actions ?? [])
      .filter(
        (action) => action.failed || action.status === 'failed' || action.status === 'timedout',
      )
      .map((action) => ({ name: step.name ?? 'unnamed', outputUrl: action.output_url })),
  );
  const chunks = await Promise.all(
    actions.map(async (action) => {
      /** @type {CircleLogMessage[]} */
      const messages = action.outputUrl ? await readJson(action.outputUrl, {}) : [];
      return `\nSTEP: ${action.name}\n${messages.map((item) => item.message ?? '').join('')}`;
    }),
  );
  return { log: chunks.join('') };
}

/** @type {import('yargs').CommandBuilder<{}, CiLogsArgs>} */
const builder = (yargs) =>
  yargs
    .positional('service', {
      choices: SERVICES,
      description: 'CI service to fetch logs from',
      demandOption: true,
    })
    .positional('repository', {
      type: 'string',
      description: 'GitHub repository in OWNER/REPO format',
      demandOption: true,
    })
    .positional('job', {
      type: 'string',
      description: 'Numeric job ID, or a Netlify deploy ID',
      demandOption: true,
    })
    .positional('output', {
      type: 'string',
      description: 'Optional path where a copy of the log should be written',
    })
    .option('head', {
      type: 'string',
      description: 'Expected commit SHA (required for Netlify)',
    });

export default /** @type {import('yargs').CommandModule<{}, CiLogsArgs>} */ ({
  command: 'ci-logs <service> <repository> <job> [output]',
  describe: 'Fetch failed logs from a CI service',
  builder,
  handler: async ({ service, repository, job, output, head }) => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
      throw new Error('Repository must use the OWNER/REPO format.');
    }
    if (service === 'netlify' ? !/^[a-f0-9]{24}$/i.test(job) : !/^[1-9][0-9]*$/.test(job)) {
      throw new Error(`Invalid ${service} job ID.`);
    }
    if (service === 'netlify' && !/^[a-f0-9]{40}$/i.test(head ?? '')) {
      throw new Error('A 40-character --head SHA is required for Netlify logs.');
    }
    if (service !== 'netlify' && head !== undefined) {
      throw new Error('--head is only supported for Netlify logs.');
    }

    const result = await fetchCiLogs(service, repository, job, head);
    const log = stripVTControlCharacters(result.log);
    if (!log.trim()) {
      throw new Error('CI log retrieval returned no log content.');
    }
    if (output) {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, log);
    }
    process.stdout.write(log);
    if (!log.endsWith('\n')) {
      process.stdout.write('\n');
    }
  },
});
