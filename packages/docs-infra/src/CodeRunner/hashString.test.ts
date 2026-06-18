import { describe, it, expect } from 'vitest';
import { hashString } from './hashString';

describe('hashString', () => {
  it('is deterministic for the same input', () => {
    expect(hashString('hello world')).toBe(hashString('hello world'));
  });

  it('produces different output for different input', () => {
    expect(hashString('button')).not.toBe(hashString('icon'));
  });

  it('returns a base36 string (only 0-9 and a-z)', () => {
    const hash = hashString('.some { css: source; }');
    for (const char of hash) {
      expect('0123456789abcdefghijklmnopqrstuvwxyz'.includes(char)).toBe(true);
    }
  });

  it('handles an empty string without throwing', () => {
    expect(typeof hashString('')).toBe('string');
  });

  it('is sensitive to character order', () => {
    expect(hashString('ab')).not.toBe(hashString('ba'));
  });
});
