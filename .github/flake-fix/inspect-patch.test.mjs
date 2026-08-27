// Tests for the patch guard. Builds real patches with git in a temp repo and asserts which ones
// the guard accepts and which it refuses.
//
// Run: node --test .github/sandbox/inspect-patch.test.mjs

import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GUARD = new URL('./inspect-patch.mjs', import.meta.url).pathname;

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
  git('add', '-A');
  git('commit', '-qm', 'init');
  return { dir, git };
}

function patchOf({ dir, git }, mutate) {
  mutate();
  git('add', '-A');
  const patch = git('diff', '--cached', '--binary');
  git('reset', '-q', '--hard');
  const patchFile = path.join(dir, 'candidate.patch');
  fs.writeFileSync(patchFile, patch);
  return patchFile;
}

function runGuard(patchFile, dir) {
  const result = spawnSync(process.execPath, [GUARD, patchFile, dir], { encoding: 'utf8' });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

test('accepts a small edit to a normal file', () => {
  const repo = makeRepo();
  const patchFile = patchOf(repo, () => {
    fs.appendFileSync(
      path.join(repo.dir, '.circleci', 'config.yml'),
      '  NPM_CONFIG_MINIMUM_RELEASE_AGE: 0\n',
    );
  });
  const { code, out } = runGuard(patchFile, repo.dir);
  assert.equal(code, 0, out);
  assert.match(out, /patch ok/);
});

test('accepts an empty patch (no proposed change)', () => {
  const repo = makeRepo();
  const patchFile = path.join(repo.dir, 'empty.patch');
  fs.writeFileSync(patchFile, '');
  const { code, out } = runGuard(patchFile, repo.dir);
  assert.equal(code, 0, out);
});

test('rejects a patch that edits a workflow file', () => {
  const repo = makeRepo();
  const patchFile = patchOf(repo, () => {
    fs.appendFileSync(path.join(repo.dir, '.github', 'workflows', 'ci.yml'), 'on: push\n');
  });
  const { code, out } = runGuard(patchFile, repo.dir);
  assert.equal(code, 1, out);
  assert.match(out, /workflow file/);
});

test('rejects an oversized patch', () => {
  const repo = makeRepo();
  const patchFile = patchOf(repo, () => {
    const bulk = Array.from({ length: 500 }, (_, index) => `line ${index}`).join('\n');
    fs.writeFileSync(path.join(repo.dir, 'big.txt'), bulk);
  });
  const { code, out } = runGuard(patchFile, repo.dir);
  assert.equal(code, 1, out);
  assert.match(out, /too large|line/);
});
