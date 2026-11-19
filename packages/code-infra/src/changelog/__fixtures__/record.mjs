// Records the GitHub responses and workspace manifests of release ranges for `recordings.ts`.
// node record.mjs <repo> <checkout> <out-dir> <lastRelease..release>...
// Needs `gh auth token`. Bodies keep only the lines that cherry-pick attribution or package
// mentions read, to keep recordings small.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { Octokit } from '@octokit/rest';
import { fetchCommitsBetweenRefs } from '../fetchChangelogs.mjs';

const RELEVANT = /cherry[- ]?pick|original|x-chat-headless|x-charts-vendor/i;
const RECORDED_STATUSES = [200, 204, 404];

const [repo, checkout, outDir, ...ranges] = process.argv.slice(2);

/** @param {...string} args */
function git(...args) {
  return execFileSync('git', args, { cwd: checkout, encoding: 'utf8', maxBuffer: 1 << 28 });
}

/** @param {string | null | undefined} text */
function relevantLines(text) {
  if (text === null || text === undefined) {
    return text;
  }

  const lines = text.split(/\r?\n/);

  return lines
    .filter((line, index) => RELEVANT.test(line) || RELEVANT.test(lines[index - 1] ?? ''))
    .join('\n');
}

/**
 * @param {string} pathname
 * @param {any} body
 */
function trim(pathname, body) {
  if (pathname.includes('/compare/')) {
    return {
      url: body.url,
      total_commits: body.total_commits,
      commits: body.commits.map((/** @type {any} */ commit) => ({
        sha: commit.sha,
        html_url: commit.html_url,
        author: commit.author ? { login: commit.author.login } : null,
        commit: {
          message: commit.commit.message,
          author: commit.commit.author
            ? { name: commit.commit.author.name, date: commit.commit.author.date }
            : null,
        },
      })),
    };
  }

  if (/\/pulls\/\d+$/.test(pathname)) {
    return {
      number: body.number,
      title: body.title,
      body: relevantLines(body.body),
      labels: body.labels.map((/** @type {{ name: string }} */ label) => ({ name: label.name })),
      user: body.user ? { login: body.user.login } : null,
      author_association: body.author_association,
      merged_at: body.merged_at,
      created_at: body.created_at,
      html_url: body.html_url,
    };
  }

  return body;
}

/** @type {Map<string, { status: number; headers: Record<string, string>; body: unknown }>} */
const responses = new Map();

/**
 * @param {Parameters<typeof fetch>[0]} input
 * @param {RequestInit} [init]
 */
async function recordingFetch(input, init) {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const key = `${request.method} ${url.pathname}${url.search}`;
  let entry = responses.get(key);

  if (!entry) {
    const response = await fetch(request);
    const text = await response.text();

    if (!RECORDED_STATUSES.includes(response.status)) {
      throw new Error(`${key} -> ${response.status} ${text.slice(0, 200)}`);
    }

    /** @type {Record<string, string>} */
    const headers = {};

    for (const name of ['link', 'content-type']) {
      const value = response.headers.get(name);

      if (value) {
        headers[name] = value;
      }
    }

    const body = text ? JSON.parse(text) : null;
    entry = {
      status: response.status,
      headers,
      body: response.ok ? trim(url.pathname, body) : { message: body?.message },
    };
    responses.set(key, entry);
  }

  const replay = new Response(entry.status === 204 ? null : JSON.stringify(entry.body), {
    status: entry.status,
    headers: entry.headers,
  });

  return Object.defineProperty(replay, 'url', { value: request.url });
}

/** @param {string} ref */
function workspace(ref) {
  /** @type {string[]} */
  const globs = [];
  let inPackages = false;

  for (const line of git('show', `${ref}:pnpm-workspace.yaml`).split('\n')) {
    if (/^packages:/.test(line)) {
      inPackages = true;
      continue;
    }

    const match = line.match(/^\s+-\s+['"]?([^'"]+)['"]?\s*$/);

    if (inPackages && match) {
      globs.push(match[1]);
    } else if (inPackages && /^\S/.test(line)) {
      break;
    }
  }

  const include = globs.filter((glob) => !glob.startsWith('!'));
  const exclude = globs.flatMap((glob) => (glob.startsWith('!') ? [glob.slice(1)] : []));

  const packages = git('ls-tree', '-r', '--name-only', ref)
    .split('\n')
    .flatMap((file) => {
      const directory = path.posix.dirname(file);

      if (
        !file.endsWith('/package.json') ||
        !include.some((glob) => path.posix.matchesGlob(directory, glob)) ||
        exclude.some((glob) => path.posix.matchesGlob(directory, glob))
      ) {
        return [];
      }

      const manifest = JSON.parse(git('show', `${ref}:${file}`));

      return [
        {
          path: directory,
          name: manifest.name ?? null,
          version: manifest.version ?? null,
          private: manifest.private === true,
        },
      ];
    });

  const root = JSON.parse(git('show', `${ref}:package.json`));

  return {
    globs,
    root: { name: root.name ?? null, version: root.version ?? null, private: root.private === true },
    packages,
  };
}

/** Component folders, which Material UI routes `[Button]` prefixes by. @param {string} ref */
function componentDirs(ref) {
  if (repo !== 'material-ui') {
    return undefined;
  }

  return Object.fromEntries(
    ['system', 'material', 'lab'].map((pkg) => {
      const directory = `packages/mui-${pkg}/src`;
      const names = git('ls-tree', '-d', '--name-only', `${ref}:${directory}`).split('\n');

      return [directory, names.filter(Boolean)];
    }),
  );
}

const octokit = new Octokit({
  auth: execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim(),
  request: { fetch: recordingFetch },
});

await fs.mkdir(outDir, { recursive: true });

for (const range of ranges) {
  const [lastRelease, release] = range.split('..');
  responses.clear();

  const entries = await fetchCommitsBetweenRefs({
    octokit,
    repo,
    lastRelease,
    release,
    includeDirectCommits: true,
  });

  const recording = {
    repo,
    lastRelease,
    release,
    version: release.replace(/^v/, ''),
    // Noon UTC renders the same calendar day in every time zone the tests run in.
    date: `${git('log', '-1', '--format=%cs', release).trim()}T12:00:00.000Z`,
    workspace: { release: workspace(release), lastRelease: workspace(lastRelease) },
    componentDirs: componentDirs(release),
    responses: Object.fromEntries(responses),
  };

  await fs.writeFile(
    path.join(outDir, `${release}.json.gz`),
    gzipSync(`${JSON.stringify(recording)}\n`),
  );
  console.log(`${range}: ${entries.length} entries, ${responses.size} responses`);
}
