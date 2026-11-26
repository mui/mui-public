import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { onTestFinished } from 'vitest';
// eslint-disable-next-line import/extensions
import { fetchChangelogData } from '../index.mjs';
import type { FetchChangelogDataOptions } from '../types';
import type { DummyGitHub } from './github';

/** The changelog data of v1.1.0 of `mui/test`, without a checkout. */
export async function fetchDummyRelease(
  { octokit }: DummyGitHub,
  options: Pick<FetchChangelogDataOptions, 'includeDirectCommits' | 'excludeBots'> = {},
) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-dummy-'));
  onTestFinished(() => fs.rm(cwd, { recursive: true, force: true }));

  return fetchChangelogData({
    cwd,
    octokit,
    repo: 'test',
    lastRelease: 'v1.0.0',
    release: 'v1.1.0',
    ...options,
  });
}
