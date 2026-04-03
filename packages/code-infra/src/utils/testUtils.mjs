import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { onTestFinished } from 'vitest';

/**
 * Creates a temporary directory and registers an `onTestFinished` hook to
 * remove it automatically when the current test ends — even if the test throws.
 *
 * @returns {Promise<string>} The path of the created temporary directory.
 */
export async function makeTempDir() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-infra-test-'));
  onTestFinished(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
  return tmpDir;
}
