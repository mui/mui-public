import { describe, it, expect } from 'vitest';
import { hashCacheContent } from './hashCacheContent';

describe('hashCacheContent', () => {
  it('returns a 64-character hex digest', () => {
    const hash = hashCacheContent('hello world');
    expect(hash).toHaveLength(64);
  });

  it('is deterministic for identical content', () => {
    expect(hashCacheContent('# Components\n')).toBe(hashCacheContent('# Components\n'));
  });

  it('differs when content differs', () => {
    expect(hashCacheContent('a')).not.toBe(hashCacheContent('b'));
  });

  it('matches the known sha256 of a fixed string', () => {
    // `printf abc | sha256sum`
    expect(hashCacheContent('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
