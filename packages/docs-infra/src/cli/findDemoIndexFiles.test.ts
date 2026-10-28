import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findDemoIndexFiles, patternToRegExp } from './findDemoIndexFiles';

describe('patternToRegExp', () => {
  it('matches a demo index path with a single wildcard segment', () => {
    const regex = patternToRegExp('./app/components/demos/*/index.ts');
    expect(regex.test('/repo/app/components/demos/button/index.ts')).toBe(true);
    // Wildcards match a single path segment, so a nested demo should not match.
    expect(regex.test('/repo/app/components/demos/button/demo-a/index.ts')).toBe(false);
  });

  it('matches across nested directories with a double wildcard', () => {
    const regex = patternToRegExp('./app/**/demos/*/index.ts');
    expect(regex.test('/repo/app/components/code/demos/button/index.ts')).toBe(true);
    expect(regex.test('/repo/app/demos/button/index.ts')).toBe(true);
    expect(regex.test('/repo/app/components/button/index.ts')).toBe(false);
  });

  it('does not match a different file name', () => {
    const regex = patternToRegExp('./app/**/demos/*/index.ts');
    expect(regex.test('/repo/app/components/demos/button/client.ts')).toBe(false);
  });

  it('passes a RegExp through unchanged', () => {
    const original = /[/\\]demos[/\\][^/\\]+[/\\]index\.ts$/;
    expect(patternToRegExp(original)).toBe(original);
  });

  it('keeps a literal separator after a segment that ends in the sentinel text', () => {
    // Regression: naive string sentinels could be forged at a substitution
    // boundary — an input segment ending in "NOT_" fusing with an inserted
    // separator placeholder and collapsing into a wildcard. NUL-byte sentinels
    // make that impossible, so the "NOT_" directory stays a literal segment.
    const regex = patternToRegExp('./a/NOT_/demos/*/index.ts');
    expect(regex.test('/repo/a/NOT_/demos/x/index.ts')).toBe(true);
    expect(regex.test('/repo/a/other/demos/x/index.ts')).toBe(false);
  });
});

describe('findDemoIndexFiles', () => {
  it('finds index.ts files that match the glob and records the matching pattern', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'find-demo-index-'));
    try {
      const pattern = './app/**/demos/*/index.ts';
      const matchDir = path.join(dir, 'app', 'components', 'demos', 'button');
      await mkdir(matchDir, { recursive: true });
      await writeFile(path.join(matchDir, 'index.ts'), '', 'utf-8');

      // A sibling file that should not be picked up.
      await writeFile(path.join(matchDir, 'client.ts'), '', 'utf-8');

      // An index.ts outside the demos folder should not match.
      const otherDir = path.join(dir, 'app', 'components', 'button');
      await mkdir(otherDir, { recursive: true });
      await writeFile(path.join(otherDir, 'index.ts'), '', 'utf-8');

      const found = await findDemoIndexFiles(dir, [pattern]);

      expect([...found.keys()]).toEqual([path.join(matchDir, 'index.ts')]);
      expect(found.get(path.join(matchDir, 'index.ts'))).toBe(pattern);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns an empty map when no patterns match', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'find-demo-index-'));
    try {
      const found = await findDemoIndexFiles(dir, ['./app/**/demos/*/index.ts']);
      expect(found.size).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('records each index.ts once against the first matching pattern', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'find-demo-index-'));
    try {
      const matchDir = path.join(dir, 'app', 'components', 'demos', 'button');
      await mkdir(matchDir, { recursive: true });
      const indexPath = path.join(matchDir, 'index.ts');
      await writeFile(indexPath, '', 'utf-8');

      // Two patterns both match the same file; the first one wins.
      const first = './app/**/demos/*/index.ts';
      const second = './app/**/index.ts';
      const found = await findDemoIndexFiles(dir, [first, second]);

      expect([...found.keys()]).toEqual([indexPath]);
      expect(found.get(indexPath)).toBe(first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('matches files when given a RegExp pattern (webpack rule shape)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'find-demo-index-'));
    try {
      const matchDir = path.join(dir, 'app', 'x', 'demos', 'button');
      await mkdir(matchDir, { recursive: true });
      const indexPath = path.join(matchDir, 'index.ts');
      await writeFile(indexPath, '', 'utf-8');

      const regex = /[/\\]demos[/\\][^/\\]+[/\\]index\.ts$/;
      const found = await findDemoIndexFiles(dir, [regex]);

      expect([...found.keys()]).toEqual([indexPath]);
      expect(found.get(indexPath)).toBe(regex);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
