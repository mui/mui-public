import fs from 'node:fs/promises';
import { expect, it, onTestFinished } from 'vitest';
import { pathToFileURL } from 'node:url';
// eslint-disable-next-line import/extensions
import { generateChangelog } from '../index.mjs';
import { listRecordings, materialize, readRecording, replay } from './recordings';
// eslint-disable-next-line import/extensions
import { coreChangelog } from './core.changelog.mjs';

it.each(await listRecordings('core'))('Core module renders %s as the config did', async (file) => {
  const recording = await readRecording(file);
  const cwd = await materialize(recording);
  onTestFinished(() => fs.rm(cwd, { recursive: true, force: true }));

  const { markdown } = await generateChangelog({
    ...coreChangelog(pathToFileURL(`${cwd}/`)),
    cwd,
    repo: recording.repo,
    octokit: replay(recording),
    lastRelease: recording.lastRelease,
    release: recording.release,
    version: recording.version,
    date: new Date(recording.date),
  });

  await expect(markdown).toMatchFileSnapshot(`./snapshots/core/${recording.release}.md`);
});
