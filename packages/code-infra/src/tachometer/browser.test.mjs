import { describe, expect, it } from 'vitest';
import { majorVersionOf } from './browser.mjs';

describe('majorVersionOf', () => {
  it('reads the major from Chrome for Testing output', () => {
    expect(majorVersionOf('Google Chrome for Testing 151.0.7922.34')).toBe(151);
  });

  it('reads the major from plain Chrome output', () => {
    expect(majorVersionOf('Google Chrome 152.0.6367.60')).toBe(152);
  });

  it('reads the major from a bare package version', () => {
    // chromedriver's package.json version, which is what the driver side is read from.
    expect(majorVersionOf('151.0.5')).toBe(151);
  });

  it('returns undefined when there is no version to read', () => {
    expect(majorVersionOf('')).toBeUndefined();
    expect(majorVersionOf('no version here')).toBeUndefined();
  });

  it('ignores a leading number that is not part of a version', () => {
    // Requires three dot-separated components, so a stray count cannot be mistaken for a version.
    expect(majorVersionOf('2 browsers found: Chrome 151.0.7922.34')).toBe(151);
  });
});
