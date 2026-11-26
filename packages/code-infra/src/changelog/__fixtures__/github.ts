import { Octokit } from '@octokit/rest';

export interface PullFixture {
  number: number;
  /** Where the pull request is, by default `mui/test`. */
  repository?: string;
  title?: string;
  body?: string;
  login?: string;
  /** By default, when the login is the one of a bot. */
  isBot?: boolean;
  /** Logins. */
  assignees?: string[];
  association?: string;
  labels?: string[];
  mergedAt?: string | null;
  mergeCommitSha?: string;
}

export interface CommitFixture {
  message: string;
  sha?: string;
  /** Author with a GitHub account. */
  login?: string;
  /** What GitHub lists for the commit. Merged as this commit, unless they say otherwise. */
  pulls?: PullFixture[];
}

export interface ResponseFixture {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Where redirects ended up. */
  url?: string;
}

export interface GitHubFixture {
  /** Commits of the release, oldest first. */
  commits?: CommitFixture[];
  /** Pull requests other than the ones of the commits. */
  pulls?: PullFixture[];
  /** SHAs of refs, where `null` is unknown to GitHub. */
  refs?: Record<string, string | null>;
  /** Overrides by path. */
  responses?: Record<string, ResponseFixture | (() => Promise<ResponseFixture>)>;
}

export const RATE_LIMITED: ResponseFixture = {
  status: 403,
  body: { message: 'API rate limit exceeded' },
  headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '4102444800' },
};
export const FORBIDDEN: ResponseFixture = { status: 403, body: { message: 'Forbidden' } };
export const NOT_FOUND: ResponseFixture = { status: 404, body: { message: 'Not Found' } };

export interface DummyGitHub {
  octokit: Octokit;
  /** Paths that were requested. */
  requests: string[];
}

/** SHA of the commit at `index`, when it isn't given one. */
export function shaOf(index: number) {
  return String(index + 1).padStart(40, '0');
}

function accountType(login: string, isBot = login === 'Copilot' || login.endsWith('[bot]')) {
  return isBot ? 'Bot' : 'User';
}

function toPull(pull: PullFixture, sha?: string) {
  const login = pull.login ?? 'contributor';
  return {
    number: pull.number,
    title: pull.title ?? `Pull request ${pull.number}`,
    body: pull.body ?? null,
    user: { login, type: accountType(login, pull.isBot) },
    assignees: (pull.assignees ?? []).map((assignee) => ({
      login: assignee,
      type: accountType(assignee),
    })),
    author_association: pull.association ?? 'CONTRIBUTOR',
    labels: (pull.labels ?? []).map((name) => ({ name })),
    html_url: `https://github.com/${pull.repository ?? 'mui/test'}/pull/${pull.number}`,
    created_at: '2026-01-01T10:00:00Z',
    merged_at: pull.mergedAt === undefined ? '2026-01-01T12:00:00Z' : pull.mergedAt,
    merge_commit_sha: pull.mergeCommitSha ?? sha,
  };
}

/** An Octokit of which the responses for the repository `mui/test` are made up from `fixture`. */
export function createGitHub(fixture: GitHubFixture = {}): DummyGitHub {
  const commits = (fixture.commits ?? []).map((commit, index) => ({
    ...commit,
    sha: commit.sha ?? shaOf(index),
  }));
  const requests: string[] = [];

  async function respond(url: URL): Promise<ResponseFixture> {
    const override = fixture.responses?.[url.pathname];
    if (override) {
      return typeof override === 'function' ? override() : override;
    }

    const commitPulls = /^\/repos\/mui\/test\/commits\/([^/]+)\/pulls$/.exec(url.pathname);
    if (commitPulls) {
      const commit = commits.find(({ sha }) => sha === commitPulls[1]);
      return { status: 200, body: (commit?.pulls ?? []).map((pull) => toPull(pull, commit?.sha)) };
    }

    const commit = /^\/repos\/mui\/test\/commits\/([^/]+)$/.exec(url.pathname);
    if (commit) {
      const ref = commit[1];
      const sha = fixture.refs?.[ref] === undefined ? ref : fixture.refs[ref];
      return sha === null
        ? { status: 422, body: { message: `No commit found for SHA: ${ref}` } }
        : { status: 200, body: { sha, commit: { committer: { date: '2026-01-02T00:00:00Z' } } } };
    }

    if (url.pathname.startsWith('/repos/mui/test/compare/')) {
      const perPage = Number(url.searchParams.get('per_page') ?? 250);
      const page = Number(url.searchParams.get('page') ?? 1);
      const next = new URL(url);
      next.searchParams.set('page', String(page + 1));
      return {
        status: 200,
        body: {
          url: url.href,
          total_commits: commits.length,
          commits: commits.slice((page - 1) * perPage, page * perPage).map(({ sha, ...entry }) => ({
            sha,
            html_url: `https://github.com/mui/test/commit/${sha}`,
            author: entry.login ? { login: entry.login, type: accountType(entry.login) } : null,
            commit: {
              message: entry.message,
              author: { name: 'Git Author', date: '2026-01-01T00:00:00Z' },
              committer: { name: 'GitHub', date: '2026-01-02T00:00:00Z' },
            },
          })),
        },
        headers: page * perPage < commits.length ? { link: `<${next.href}>; rel="next"` } : {},
      };
    }

    const pull = fixture.pulls?.find(
      ({ repository = 'mui/test', number }) =>
        url.pathname === `/repos/${repository}/pulls/${number}`,
    );
    return pull ? { status: 200, body: toPull(pull) } : NOT_FOUND;
  }

  const octokit = new Octokit({
    log: { debug() {}, info() {}, warn() {}, error() {} },
    request: {
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(new URL(request.url).pathname);
        const { status, body, headers, url } = await respond(new URL(request.url));
        request.signal.throwIfAborted();
        const response = new Response(body === undefined ? null : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json', ...headers },
        });
        return Object.defineProperty(response, 'url', { value: url ?? request.url });
      },
    },
  });

  return { octokit, requests };
}
