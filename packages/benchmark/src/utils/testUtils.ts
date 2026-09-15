import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { onTestFinished } from 'vitest';

/** Creates a temporary directory and removes it when the current test ends, even if it throws. */
export async function makeTempDir(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-test-'));
  onTestFinished(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
  return tmpDir;
}
