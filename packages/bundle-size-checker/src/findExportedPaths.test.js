import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { findExportedPaths } from './findExportedPaths.js';

const fixturesDir = fileURLToPath(new URL('./__fixtures__/exports', import.meta.url));

/**
 * @param {string} name
 * @returns {string}
 */
function pkgJson(name) {
  return path.join(fixturesDir, name, 'package.json');
}

describe('findExportedPaths', () => {
  it('returns concrete subpaths unchanged when there are no wildcards', async () => {
    expect(await findExportedPaths(pkgJson('static-only'))).toEqual([
      '.',
      './package.json',
      './utils',
    ]);
  });

  it('expands a wildcard subpath export against files on disk', async () => {
    expect(await findExportedPaths(pkgJson('wildcard-basic'))).toEqual(['.', './a', './b']);
  });

  it('expands wildcards across path separators, matching Node subpath semantics', async () => {
    expect(await findExportedPaths(pkgJson('wildcard-nested'))).toEqual(['./a', './sub/c']);
  });

  it('resolves the wildcard target from runtime conditions, ignoring types', async () => {
    expect(await findExportedPaths(pkgJson('wildcard-conditions'))).toEqual(['./a', './b']);
  });

  it('drops paths blocked by a null negation pattern', async () => {
    expect(await findExportedPaths(pkgJson('wildcard-negation'))).toEqual(['./a']);
  });

  it('drops wildcard keys whose value has no expandable target', async () => {
    expect(await findExportedPaths(pkgJson('wildcard-no-target'))).toEqual([]);
  });
});
