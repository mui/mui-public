import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Octokit } from '@octokit/rest';
import { execa } from 'execa';
import { onTestFinished } from 'vitest';

// Keeps a contributor's own git config (signing, hooks) out of the fixture commits.
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Git Author',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_DATE: '2026-01-02T00:00:00Z',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

export interface PullFixture {
  number: number;
  title?: string;
  body?: string | null;
  login?: string | null;
  association?: string;
  labels?: string[];
  mergedAt?: string | null;
  mergeCommitSha?: string;
}

export interface CannedResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Where redirects ended up. */
  url?: string;
}

type Git = (...args: string[]) => Promise<string>;

type Files = Record<string, unknown>;

export interface ChangelogRepository {
  dir: string;
  name: string;
  git: Git;
  octokit: Octokit;
  /** Paths GitHub was asked for, without the repository. */
  requests: string[];
  /** Replaces the response of a path, until the returned function is called. */
  respondWith(
    route: string,
    response: CannedResponse | (() => Promise<CannedResponse>),
  ): () => void;
  /** Adds a pull request to the repository `owner/name`, by default this one. */
  addPull(pull: PullFixture, repository?: string): void;
  /** Commits `files` as the merge of the first of `associated`, the pull requests GitHub lists. */
  land(message: string, associated?: PullFixture[], files?: Files): Promise<string>;
  /** Commits without a pull request, optionally by someone with a GitHub account. */
  push(message: string, login?: string): Promise<string>;
  /** A checkout of which `origin` is a GitHub URL that is fetched from `dir`. */
  clone(...args: string[]): Promise<{ dir: string; git: Git }>;
}

export async function tempDir() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-data-')));
  onTestFinished(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

function gitIn(cwd: string): Git {
  return async (...args) => (await execa('git', args, { cwd, env: GIT_ENV })).stdout;
}

/** Writes files, where `null` removes one. */
export async function writeFiles(dir: string, files: Files) {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    if (content === null) {
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(target);
    } else {
      // eslint-disable-next-line no-await-in-loop
      await fs.mkdir(path.dirname(target), { recursive: true });
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(target, typeof content === 'string' ? content : JSON.stringify(content));
    }
  }
}

function pullResponse(pull: PullFixture, repository: string, sha?: string) {
  const login = pull.login === undefined ? 'contributor' : pull.login;
  return {
    number: pull.number,
    title: pull.title ?? `Pull request ${pull.number}`,
    body: pull.body ?? null,
    user: login && { login, type: login.endsWith('[bot]') ? 'Bot' : 'User' },
    author_association: pull.association ?? 'CONTRIBUTOR',
    labels: (pull.labels ?? []).map((name) => ({ name })),
    html_url: `https://github.com/${repository}/pull/${pull.number}`,
    created_at: '2026-01-01T10:00:00Z',
    merged_at: pull.mergedAt === undefined ? '2026-01-01T12:00:00Z' : pull.mergedAt,
    merge_commit_sha: pull.mergeCommitSha ?? sha,
  };
}

/**
 * The GitHub repository `mui/<name>`, released as v1.0.0: a git repository for what it contains, and
 * a real Octokit of which the HTTP responses are derived from it.
 */
export async function createRepository(files: Files = {}): Promise<ChangelogRepository> {
  const dir = await tempDir();
  const name = path.basename(dir);
  const git = gitIn(dir);
  const pulls = new Map<string, PullFixture[]>();
  const accounts = new Map<string, { login: string; type: string } | null>();
  const overrides = new Map<string, CannedResponse | (() => Promise<CannedResponse>)>();
  const requests: string[] = [];

  await git('init', '--initial-branch=main');
  await writeFiles(dir, {
    'package.json': { name: 'root', version: '1.0.0', private: true },
    ...files,
  });
  await git('add', '-A');
  await git('commit', '-m', 'Initial');
  await git('tag', 'v1.0.0');

  async function listCommits(basehead: string) {
    const [base, head] = basehead.split('...');
    const log = await git(
      'log',
      '--reverse',
      '--topo-order',
      '-z',
      '--format=%H%n%B',
      `${base}..${head}`,
    );
    return log
      .split('\0')
      .filter(Boolean)
      .map((entry) => {
        const sha = entry.slice(0, 40);
        return {
          sha,
          html_url: `https://github.com/mui/${name}/commit/${sha}`,
          author: accounts.get(sha) ?? null,
          commit: {
            message: entry.slice(41).trim(),
            author: { name: 'Git Author', date: '2026-01-01T00:00:00Z' },
            committer: { name: 'Fixture', date: '2026-01-02T00:00:00Z' },
          },
        };
      });
  }

  async function respond(url: URL): Promise<CannedResponse> {
    const route = url.pathname.replace(`/repos/mui/${name}/`, '');
    const override = overrides.get(route);
    if (override) {
      return typeof override === 'function' ? override() : override;
    }

    let match = /^commits\/([^/]+)\/pulls$/.exec(route);
    if (match) {
      const sha = match[1];
      const body = (pulls.get(sha) ?? []).map((pull) => pullResponse(pull, `mui/${name}`, sha));
      return { status: 200, body };
    }
    match = /^commits\/(.+)$/.exec(route);
    if (match) {
      const ref = decodeURIComponent(match[1]);
      const sha = await git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`).catch(
        () => null,
      );
      return sha
        ? { status: 200, body: { sha, commit: { committer: { date: '2026-01-02T00:00:00Z' } } } }
        : { status: 422, body: { message: `No commit found for SHA: ${ref}` } };
    }
    match = /^compare\/(.+)$/.exec(route);
    if (match) {
      const commits = await listCommits(match[1]);
      const perPage = Number(url.searchParams.get('per_page') ?? 250);
      const page = Number(url.searchParams.get('page') ?? 1);
      const next = new URL(url);
      next.searchParams.set('page', String(page + 1));
      return {
        status: 200,
        body: {
          url: url.href,
          total_commits: commits.length,
          commits: commits.slice((page - 1) * perPage, page * perPage),
        },
        headers: page * perPage < commits.length ? { link: `<${next.href}>; rel="next"` } : {},
      };
    }
    match = /^git\/trees\/(.+)$/.exec(route);
    if (match) {
      const list = await git('ls-tree', '-r', '-t', '-z', match[1]);
      const tree = list
        .split('\0')
        .filter(Boolean)
        .map((line) => {
          const [, mode, type, sha, file] = /^(\d+) (\w+) (\w+)\t(.*)$/.exec(line)!;
          return { path: file, mode, type, sha };
        });
      return { status: 200, body: { sha: match[1], tree, truncated: false } };
    }
    match = /^git\/blobs\/(.+)$/.exec(route);
    if (match) {
      const content = Buffer.from(await git('cat-file', 'blob', match[1])).toString('base64');
      return { status: 200, body: { content, encoding: 'base64' } };
    }
    return { status: 404, body: { message: 'Not Found' } };
  }

  const octokit = new Octokit({
    log: { debug() {}, info() {}, warn() {}, error() {} },
    request: {
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        requests.push(`${url.pathname.replace(`/repos/mui/${name}/`, '')}${url.search}`);
        const { status, body, headers, url: finalUrl } = await respond(url);
        request.signal.throwIfAborted();
        const response = new Response(body === undefined ? null : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json', ...headers },
        });
        return Object.defineProperty(response, 'url', { value: finalUrl ?? request.url });
      },
    },
  });

  return {
    dir,
    name,
    git,
    octokit,
    requests,

    respondWith(route: string, response: CannedResponse | (() => Promise<CannedResponse>)) {
      const replaced = overrides.get(route);
      overrides.set(route, response);
      return () => {
        if (replaced) {
          overrides.set(route, replaced);
        } else {
          overrides.delete(route);
        }
      };
    },

    addPull(pull: PullFixture, repository = `mui/${name}`) {
      const route =
        repository === `mui/${name}`
          ? `pulls/${pull.number}`
          : `/repos/${repository}/pulls/${pull.number}`;
      overrides.set(route, { status: 200, body: pullResponse(pull, repository) });
    },

    async land(message: string, associated: PullFixture[] = [], changedFiles: Files = {}) {
      await writeFiles(dir, changedFiles);
      await git('add', '-A');
      await git('commit', '--allow-empty', '-m', message);
      const sha = await git('rev-parse', 'HEAD');
      pulls.set(sha, associated);
      return sha;
    },

    async push(message: string, login?: string) {
      await git('commit', '--allow-empty', '-m', message);
      const sha = await git('rev-parse', 'HEAD');
      if (login) {
        accounts.set(sha, { login, type: login.endsWith('[bot]') ? 'Bot' : 'User' });
      }
      return sha;
    },

    async clone(...args: string[]) {
      const checkout = await tempDir();
      await execa('git', ['clone', ...args, `file://${dir}`, checkout], { env: GIT_ENV });
      const url = `https://github.com/mui/${name}.git`;
      const checkoutGit = gitIn(checkout);
      await checkoutGit('remote', 'set-url', 'origin', url);
      await checkoutGit('config', `url.file://${dir}.insteadOf`, url);
      return { dir: checkout, git: checkoutGit };
    },
  };
}
