import { describe, it, expect } from 'vitest';

import { makeTempDir, writePackage } from '../utils/testUtils.mjs';
import { getReleaseVersion } from './cmdPublish.mjs';

describe('getReleaseVersion', () => {
  it('reads the version from the root manifest', async () => {
    const root = await makeTempDir();
    const pkgDir = await writePackage(root, 'pkg', { name: 'root', version: '1.2.3' });

    expect(await getReleaseVersion(pkgDir)).toBe('1.2.3');
  });

  it('normalizes a valid but non-canonical version', async () => {
    const root = await makeTempDir();
    const pkgDir = await writePackage(root, 'pkg', { name: 'root', version: 'v2.0.0' });

    expect(await getReleaseVersion(pkgDir)).toBe('2.0.0');
  });

  it('returns null when no version is present', async () => {
    const root = await makeTempDir();
    const pkgDir = await writePackage(root, 'pkg', { name: 'root' });

    expect(await getReleaseVersion(pkgDir)).toBeNull();
  });

  it('returns null for a version that is not valid semver', async () => {
    const root = await makeTempDir();
    const pkgDir = await writePackage(root, 'pkg', { name: 'root', version: 'not-a-version' });

    expect(await getReleaseVersion(pkgDir)).toBeNull();
  });
});
