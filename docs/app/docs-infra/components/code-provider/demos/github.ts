/**
 * Helpers for talking to GitHub from a CodeProvider in the docs.
 *
 * Demos use these helpers to keep their loaders focused on demo-specific
 * logic (parsing the entry file, mapping variants, etc.) rather than URL
 * shape and HTTP plumbing.
 */

/**
 * Parsed `https://github.com/{owner}/{repo}/(blob|tree)/{ref}/{path}` URL.
 */
export type ParsedGitHubUrl = {
  owner: string;
  repo: string;
  kind: 'blob' | 'tree';
  ref: string;
  path: string;
};

// `process.env.SOURCE_CODE_ROOT_URL` is set by `withDeploymentConfig` to
// `https://github.com/{owner}/{repo}/tree/{ref}/`. We strip it from incoming
// URLs to recover `{path}` without having to figure out where the ref ends —
// refs may contain slashes (e.g. `feature/foo`).
const ROOT_URL = process.env.SOURCE_CODE_ROOT_URL ?? '';
const ROOT_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/(.+?)\/$/;
const ROOT_MATCH = ROOT_URL.match(ROOT_URL_RE);
if (!ROOT_MATCH) {
  throw new Error(
    `process.env.SOURCE_CODE_ROOT_URL is not a GitHub tree URL: ${JSON.stringify(ROOT_URL)}`,
  );
}
const [, ROOT_OWNER, ROOT_REPO, ROOT_REF] = ROOT_MATCH;
const ROOT_BLOB_PREFIX = `https://github.com/${ROOT_OWNER}/${ROOT_REPO}/blob/${ROOT_REF}/`;
const ROOT_TREE_PREFIX = ROOT_URL;

export function parseGitHubUrl(url: string): ParsedGitHubUrl {
  let kind: 'blob' | 'tree';
  let path: string;
  if (url.startsWith(ROOT_BLOB_PREFIX)) {
    kind = 'blob';
    path = url.slice(ROOT_BLOB_PREFIX.length);
  } else if (url === ROOT_TREE_PREFIX || url === ROOT_TREE_PREFIX.slice(0, -1)) {
    kind = 'tree';
    path = '';
  } else if (url.startsWith(ROOT_TREE_PREFIX)) {
    kind = 'tree';
    path = url.slice(ROOT_TREE_PREFIX.length);
  } else {
    throw new Error(`Not a GitHub URL under SOURCE_CODE_ROOT_URL: ${url}`);
  }
  return {
    owner: ROOT_OWNER,
    repo: ROOT_REPO,
    kind,
    ref: ROOT_REF,
    path: path.replace(/\/$/, ''),
  };
}

export function buildGitHubUrl(parsed: ParsedGitHubUrl): string {
  const { owner, repo, kind, ref, path } = parsed;
  return `https://github.com/${owner}/${repo}/${kind}/${ref}/${path}`;
}

export function toContentsApiUrl(parsed: ParsedGitHubUrl): string {
  const { owner, repo, ref, path } = parsed;
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref}`;
}

export function toRawUrl(parsed: ParsedGitHubUrl): string {
  const { owner, repo, ref, path } = parsed;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
}

export async function fetchRawSource(url: string): Promise<string> {
  const parsed = parseGitHubUrl(url);
  const response = await fetch(toRawUrl(parsed));
  if (!response.ok) {
    throw new Error(`Failed to fetch source: ${response.statusText}`);
  }
  return response.text();
}

export type GitHubContentsEntry = { type: string; name: string };

export async function fetchDirectoryEntries(
  parsed: ParsedGitHubUrl,
): Promise<GitHubContentsEntry[]> {
  const response = await fetch(toContentsApiUrl({ ...parsed, kind: 'tree' }));
  if (!response.ok) {
    throw new Error(`Failed to list directory: ${response.statusText}`);
  }
  return (await response.json()) as GitHubContentsEntry[];
}

/**
 * Calls the Contents API for the given path. The endpoint returns an array
 * for directories and a single object for files, so the result tells the
 * caller which kind of entry the path points at without a second request.
 * Returns `null` on 404 so callers can probe for paths that may not exist.
 */
export async function fetchContents(
  parsed: ParsedGitHubUrl,
): Promise<GitHubContentsEntry[] | GitHubContentsEntry | null> {
  const response = await fetch(toContentsApiUrl({ ...parsed, kind: 'tree' }));
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch contents: ${response.statusText}`);
  }
  return (await response.json()) as GitHubContentsEntry[] | GitHubContentsEntry;
}

/**
 * Per-instance cache for incremental directory listings, raw file contents
 * and ref-to-SHA lookups. Create one with `createGitHubCache()` and hold
 * it in a ref so the lifetime is tied to the React component that owns
 * the loaders. When the component remounts the ref resets and the cache
 * starts empty.
 *
 * Cache keys are full immutable paths (`${owner}/${repo}/${ref}/${path}`)
 * so different commits coexist naturally and we never serve stale data.
 * Misses are stored as `null` so we don't re-issue requests for paths
 * we've already learned don't exist.
 */
export interface GitHubCache {
  /** Resolves a (possibly mutable) ref-based URL to a SHA-pinned URL. */
  toImmutableUrl(url: string): Promise<string>;
  /**
   * Reads a directory's direct children. The URL must already be
   * immutable (see `toImmutableUrl`). Returns `null` for missing paths
   * or when the path points at a file.
   */
  readDirectory(url: string): Promise<GitHubContentsEntry[] | null>;
  /**
   * Reads a single file's raw contents. The URL must already be
   * immutable (see `toImmutableUrl`). Returns `null` for missing paths.
   */
  readFile(url: string): Promise<string | null>;
}

export function createGitHubCache(): GitHubCache {
  const shaCache = new Map<string, Promise<string>>();
  const directoryCache = new Map<string, Promise<GitHubContentsEntry[] | null>>();
  const fileCache = new Map<string, Promise<string | null>>();

  const cacheKey = (parsed: ParsedGitHubUrl) =>
    `${parsed.owner}/${parsed.repo}/${parsed.ref}/${parsed.path}`;

  return {
    async toImmutableUrl(url) {
      const parsed = parseGitHubUrl(url);
      const shaKey = `${parsed.owner}/${parsed.repo}/${parsed.ref}`;
      let shaPromise = shaCache.get(shaKey);
      if (!shaPromise) {
        shaPromise = (async () => {
          const response = await fetch(
            `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${parsed.ref}`,
            { headers: { Accept: 'application/vnd.github.sha' } },
          );
          if (!response.ok) {
            throw new Error(`Failed to resolve ref "${parsed.ref}": ${response.statusText}`);
          }
          return (await response.text()).trim();
        })();
        shaCache.set(shaKey, shaPromise);
      }
      const sha = await shaPromise;
      return buildGitHubUrl({ ...parsed, ref: sha });
    },

    readDirectory(url) {
      const parsed = parseGitHubUrl(url);
      const key = cacheKey(parsed);
      let promise = directoryCache.get(key);
      if (!promise) {
        promise = (async () => {
          const response = await fetch(toContentsApiUrl({ ...parsed, kind: 'tree' }));
          if (response.status === 404) {
            return null;
          }
          if (!response.ok) {
            throw new Error(`Failed to read directory "${parsed.path}": ${response.statusText}`);
          }
          const data = (await response.json()) as GitHubContentsEntry[] | GitHubContentsEntry;
          // Contents API returns an object (not an array) when the path is
          // a file; for directory reads that's effectively a miss.
          return Array.isArray(data) ? data : null;
        })();
        directoryCache.set(key, promise);
      }
      return promise;
    },

    readFile(url) {
      const parsed = parseGitHubUrl(url);
      const key = cacheKey(parsed);
      let promise = fileCache.get(key);
      if (!promise) {
        promise = (async () => {
          const response = await fetch(toRawUrl({ ...parsed, kind: 'blob' }));
          if (response.status === 404) {
            return null;
          }
          if (!response.ok) {
            throw new Error(`Failed to read file "${parsed.path}": ${response.statusText}`);
          }
          return response.text();
        })();
        fileCache.set(key, promise);
      }
      return promise;
    },
  };
}
