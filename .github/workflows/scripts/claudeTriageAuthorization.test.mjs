import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../claude-triage.yml', import.meta.url), 'utf8');
const script = workflow
  .split('name: Authorize the request and capture context\n')[1]
  .split('          script: |\n')[1]
  .split('\n      - name:')[0]
  .split('\n')
  .map((line) => line.slice(12))
  .join('\n');

function authorize(overrides = {}) {
  const scenario = {
    eventName: 'issue_comment',
    action: 'created',
    actorType: 'User',
    label: 'ai: needs-triage',
    configuredLabel: 'ai: needs-triage',
    commentId: 11,
    triggerCommentId: 11,
    mode: 'triage',
    permission: 'read',
    pullRequest: false,
    ...overrides,
  };
  const directory = mkdtempSync(join(tmpdir(), 'triage-authorization-'));
  const output = join(directory, 'output');
  writeFileSync(output, '');
  try {
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { Octokit } from '@octokit/rest';
      import * as core from '@actions/core';
      import { createRequire } from 'node:module';
      const require = createRequire(import.meta.url);
      const scenario = JSON.parse(process.env.SCENARIO);
      const user = { login: 'reporter', type: scenario.actorType };
      const context = {
        repo: { owner: 'example', repo: 'components' }, eventName: scenario.eventName,
        payload: { sender: user, action: scenario.action, issue: { number: 7 },
          comment: { id: scenario.triggerCommentId, user } },
      };
      const github = new Octokit({ request: { fetch: async (url) => {
        const path = new URL(url).pathname;
        let data;
        if (path.endsWith('/issues/7')) data = {
          number: 7, title: 'Example issue', state: 'open',
          labels: scenario.label ? [{ name: scenario.label }] : [],
          ...(scenario.pullRequest ? { pull_request: {} } : {}),
        };
        else if (path.endsWith('/permission')) data = { permission: scenario.permission };
        else if (path.endsWith('/repos/example/components')) data = { full_name: 'example/components', default_branch: 'master' };
        else if (path.endsWith('/branches/master')) data = { commit: { sha: 'checkout-sha' } };
        else if (path.endsWith('/issues/7/comments')) data = [{ id: 11, user, body: 'More context.' }];
        else if (path.endsWith('/reactions')) data = { id: 1 };
        else throw new Error('Unexpected request: ' + path);
        return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
      } } });
      await (async () => { ${script} })();
    `,
      ],
      {
        env: {
          ...process.env,
          SCENARIO: JSON.stringify(scenario),
          RUNNER_TEMP: directory,
          GITHUB_OUTPUT: output,
          ISSUE_NUMBER: '7',
          REQUEST_MODE: scenario.mode,
          COMMENT_ID: String(scenario.commentId),
          TRIAGE_COMMENT_LABEL: scenario.configuredLabel,
        },
        stdio: 'pipe',
      },
    );
    return Object.fromEntries(
      [...readFileSync(output, 'utf8').matchAll(/^([\w-]+)<<([^\n]+)\n([\s\S]*?)\n\2$/gm)].map(
        (match) => [match[1], match[3]],
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('Claude triage authorization', () => {
  it('accepts a human reply on a currently labeled issue and forwards only that user', () => {
    const output = authorize();
    expect(output).toMatchObject({ mode: 'triage', 'allowed-user': 'reporter', 'allowed-bot': '' });
  });

  it.each([
    ['not opted in', { configuredLabel: '' }],
    ['label removed', { label: '' }],
    ['different label', { label: 'other' }],
    ['bot reply', { actorType: 'Bot' }],
    ['fix request', { mode: 'fix' }],
    ['edited comment', { action: 'edited' }],
    ['different comment', { triggerCommentId: 12 }],
    ['no comment cutoff', { commentId: 0 }],
    ['pull request', { pullRequest: true }],
  ])('rejects a read-only user with %s', (_name, overrides) => {
    expect(authorize(overrides)).toEqual({});
  });

  it('preserves maintainer authorization without the label opt-in', () => {
    expect(authorize({ configuredLabel: '', permission: 'write' })).toMatchObject({
      mode: 'triage',
      'allowed-user': '',
    });
  });

  it('preserves bot label triggers', () => {
    expect(
      authorize({ actorType: 'Bot', eventName: 'issues', action: 'labeled', commentId: 0 }),
    ).toMatchObject({ mode: 'triage', 'allowed-bot': 'reporter', 'allowed-user': '' });
  });
});
