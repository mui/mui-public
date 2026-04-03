import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Creates a temporary directory, runs the given function with its path, then
 * removes the directory unconditionally — even if the function throws.
 *
 * @template T
 * @param {(dir: string) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTempDir(fn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-infra-test-'));
  try {
    return await fn(tmpDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
