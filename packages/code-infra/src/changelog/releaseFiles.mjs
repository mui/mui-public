import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { $ } from 'execa';

/**
 * Files of a workspace at some point in its history. Paths are relative to the workspace root, with
 * `/` separators.
 *
 * @typedef {Object} FileSource
 * @property {string[]} paths
 * @property {(path: string) => Promise<string>} read
 */

/**
 * @typedef {Object} Checkout
 * @property {string} root - Workspace root
 * @property {string} prefix - Path from the repository to the workspace root, empty or ending with `/`
 */

/**
 * @param {string} file
 */
function exists(file) {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

/**
 * The workspace `cwd` is in, without looking outside of its git repository. Without a workspace, the
 * closest package.
 *
 * @param {string} cwd - Without symlinks
 * @returns {Promise<Checkout | null>} `null` outside a git repository
 */
export async function findCheckout(cwd) {
  const { stdout, exitCode } = await $({ cwd, reject: false })`git rev-parse --show-toplevel`;
  if (exitCode !== 0) {
    return null;
  }
  const toplevel = path.normalize(stdout.trim());

  /** @type {string | null} */
  let root = null;
  /* eslint-disable no-await-in-loop */
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (await exists(path.join(dir, 'pnpm-workspace.yaml'))) {
      root = dir;
      break;
    }
    if (!root && (await exists(path.join(dir, 'package.json')))) {
      root = dir;
    }
    if (dir === toplevel || dir === path.dirname(dir)) {
      break;
    }
  }
  /* eslint-enable no-await-in-loop */
  root ??= toplevel;

  const prefix = path.relative(toplevel, root).split(path.sep).join('/');
  return { root, prefix: prefix ? `${prefix}/` : '' };
}

/**
 * @param {string} cwd
 * @param {string} sha
 * @returns {Promise<boolean>}
 */
export async function hasCommit(cwd, sha) {
  const { exitCode } = await $({ cwd, reject: false })`git cat-file -e ${sha}^{commit}`;
  return exitCode === 0;
}

/**
 * @param {string} root
 * @returns {Promise<FileSource>}
 */
export async function openWorkingTree(root) {
  const $$ = $({ cwd: root });
  const [present, deleted] = await Promise.all([
    $$`git ls-files -z --cached --others --exclude-standard`,
    $$`git ls-files -z --deleted`,
  ]);
  const gone = new Set(deleted.stdout.split('\0'));
  return {
    paths: present.stdout.split('\0').filter((file) => file && !gone.has(file)),
    read: (file) => fs.readFile(path.join(root, file), 'utf8'),
  };
}

/**
 * The files of a commit, from the checkout when it has the commit, else from GitHub.
 *
 * @param {Object} options
 * @param {import('@octokit/rest').Octokit} options.octokit
 * @param {import('./types.ts').GitHubRepository} options.repository
 * @param {Checkout | null} options.checkout
 * @param {string} options.sha
 * @param {AbortSignal} options.signal
 * @returns {Promise<FileSource>}
 */
export async function openCommit({ octokit, repository, checkout, sha, signal }) {
  if (checkout && (await hasCommit(checkout.root, sha))) {
    const $$ = $({ cwd: checkout.root });
    const { stdout } = await $$`git ls-tree -r -z --name-only ${sha}`;
    return {
      paths: stdout.split('\0').filter(Boolean),
      // `./` resolves from the workspace root, not from the repository.
      read: async (file) => (await $$`git show ${sha}:./${file}`).stdout,
    };
  }

  const prefix = checkout?.prefix ?? '';
  const parameters = { owner: repository.owner, repo: repository.name, request: { signal } };
  const { data } = await octokit.git.getTree({ ...parameters, tree_sha: sha, recursive: '1' });
  if (data.truncated) {
    throw new Error(
      `GitHub truncates the file list of ${sha}. Fetch the commit into the checkout instead.`,
    );
  }
  const blobs = new Map(
    data.tree.flatMap((entry) =>
      entry.type === 'blob' && entry.path.startsWith(prefix)
        ? [[entry.path.slice(prefix.length), entry.sha]]
        : [],
    ),
  );
  return {
    paths: [...blobs.keys()],
    read: async (file) => {
      const blob = await octokit.git.getBlob({
        ...parameters,
        file_sha: /** @type {string} */ (blobs.get(file)),
      });
      return Buffer.from(blob.data.content, 'base64').toString('utf8');
    },
  };
}
