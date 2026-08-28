// Tests for the patch sanity check. Builds real patches with git in a temp repo.

import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectPatch } from './inspect-patch.mjs';

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flake-patch-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  fs.mkdirSync(path.join(dir, '.circleci'));
  fs.writeFileSync(path.join(dir, '.circleci', 'config.yml'), 'version: 2.1\njobs: {}\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return { dir, git };
}

// Build a patch by mutating the repo, capturing the staged diff, then resetting.
function patchOf({ dir, git }, mutate) {
  mutate();
  git('add', '-A');
  const patch = git('diff', '--cached', '--binary');
  git('reset', '-q', '--hard');
  const patchFile = path.join(dir, 'candidate.patch');
  fs.writeFileSync(patchFile, patch);
  return patchFile;
}

describe('inspectPatch', () => {
  it('accepts a small edit to any file', () => {
    const repo = makeRepo();
    const patchFile = patchOf(repo, () => {
      fs.appendFileSync(
        path.join(repo.dir, '.circleci', 'config.yml'),
        '  NPM_CONFIG_MINIMUM_RELEASE_AGE: 0\n',
      );
    });
    expect(inspectPatch(patchFile, repo.dir)).toMatch(/patch ok/);
  });

  it('accepts an empty patch (no proposed change)', () => {
    const repo = makeRepo();
    const patchFile = path.join(repo.dir, 'empty.patch');
    fs.writeFileSync(patchFile, '');
    expect(inspectPatch(patchFile, repo.dir)).toMatch(/empty/);
  });

  it('rejects something git cannot parse as a patch', () => {
    const repo = makeRepo();
    const patchFile = path.join(repo.dir, 'garbage.patch');
    fs.writeFileSync(patchFile, 'this is not a patch\n');
    expect(() => inspectPatch(patchFile, repo.dir)).toThrow(/could not parse/);
  });

  it('rejects a patch that touches more files than the limit', () => {
    const repo = makeRepo();
    const patchFile = patchOf(repo, () => {
      for (let index = 0; index < 26; index += 1) {
        fs.writeFileSync(path.join(repo.dir, `f${index}.txt`), `${index}\n`);
      }
    });
    expect(() => inspectPatch(patchFile, repo.dir)).toThrow(/a minimal fix should not/);
  });

  it('rejects an oversized patch for its size specifically', () => {
    const repo = makeRepo();
    const patchFile = patchOf(repo, () => {
      const bulk = Array.from({ length: 500 }, (_, index) => `line ${index}`).join('\n');
      fs.writeFileSync(path.join(repo.dir, 'big.txt'), bulk);
    });
    expect(() => inspectPatch(patchFile, repo.dir)).toThrow(
      /too large for an automated minimal fix/,
    );
  });
});
