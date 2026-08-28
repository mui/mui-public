// Tests for the patch guard. Unit-tests the rename parser directly, and drives the whole check
// with real patches built by git in a temp repo.

import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectPatch, destinationPath } from './inspect-patch.mjs';

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flake-patch-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  fs.mkdirSync(path.join(dir, '.circleci'));
  fs.writeFileSync(path.join(dir, '.circleci', 'config.yml'), 'version: 2.1\njobs: {}\n');
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'export const value = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return { dir, git };
}

// Build a patch by mutating the repo, capturing the staged diff (with rename detection), then
// resetting. Returns the patch file path.
function patchOf({ dir, git }, mutate) {
  mutate();
  git('add', '-A');
  const patch = git('diff', '--cached', '-M', '--binary');
  git('reset', '-q', '--hard');
  const patchFile = path.join(dir, 'candidate.patch');
  fs.writeFileSync(patchFile, patch);
  return patchFile;
}

describe('destinationPath', () => {
  it('returns the path unchanged when there is no rename', () => {
    expect(destinationPath('src/app.js')).toBe('src/app.js');
  });
  it('takes the destination of a plain rename', () => {
    expect(destinationPath('old.js => new.js')).toBe('new.js');
  });
  it('takes the destination of a braced rename', () => {
    expect(destinationPath('src/{old => new}/app.js')).toBe('src/new/app.js');
  });
  it('resolves a rename whose destination is a blocked prefix', () => {
    expect(destinationPath('{src => .github/actions}/app.js')).toBe('.github/actions/app.js');
  });
});

describe('inspectPatch', () => {
  it('accepts a small edit to a normal file', () => {
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

  it('rejects an edit to a workflow file', () => {
    const repo = makeRepo();
    const patchFile = patchOf(repo, () => {
      fs.appendFileSync(path.join(repo.dir, '.github', 'workflows', 'ci.yml'), 'on: push\n');
    });
    expect(() => inspectPatch(patchFile, repo.dir)).toThrow(/GitHub Actions CI/);
  });

  it('rejects an edit to a composite action', () => {
    const repo = makeRepo();
    const patchFile = patchOf(repo, () => {
      fs.mkdirSync(path.join(repo.dir, '.github', 'actions', 'foo'), { recursive: true });
      fs.writeFileSync(
        path.join(repo.dir, '.github', 'actions', 'foo', 'action.yml'),
        'runs: {}\n',
      );
    });
    expect(() => inspectPatch(patchFile, repo.dir)).toThrow(/GitHub Actions CI/);
  });

  it('rejects a rename that moves a file into .github/actions', () => {
    const repo = makeRepo();
    const patchFile = patchOf(repo, () => {
      fs.mkdirSync(path.join(repo.dir, '.github', 'actions'), { recursive: true });
      repo.git('mv', path.join('src', 'app.js'), path.join('.github', 'actions', 'app.js'));
    });
    expect(() => inspectPatch(patchFile, repo.dir)).toThrow(/GitHub Actions CI/);
  });

  it('rejects a patch that writes into .git', () => {
    const repo = makeRepo();
    const patchFile = path.join(repo.dir, 'dotgit.patch');
    fs.writeFileSync(
      patchFile,
      'diff --git a/.git/config b/.git/config\n' +
        'new file mode 100644\n' +
        'index 0000000..0000001\n' +
        '--- /dev/null\n' +
        '+++ b/.git/config\n' +
        '@@ -0,0 +1 @@\n' +
        '+[evil]\n',
    );
    // Rejected either by our .git guard or by git refusing to parse it — both are rejections.
    expect(() => inspectPatch(patchFile, repo.dir)).toThrow();
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
