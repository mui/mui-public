import { vi, describe, it, expect } from 'vitest';
import { createRateLimiter, getClientIp } from './rateLimit';

/** A limiter whose clock is driven by the returned `advance` helper. */
function createTestLimiter(limit: number, windowMs: number) {
  let currentTime = 1_000_000;
  const limiter = createRateLimiter({ limit, windowMs, now: () => currentTime });
  return {
    limiter,
    advance(ms: number) {
      currentTime += ms;
    },
  };
}

describe('createRateLimiter', () => {
  it('allows attempts up to the limit and blocks the next one', () => {
    const { limiter } = createTestLimiter(3, 60_000);

    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
  });

  it('tracks each key separately', () => {
    const { limiter } = createTestLimiter(1, 60_000);

    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    expect(limiter.check('b').allowed).toBe(true);
  });

  it('allows attempts again once the window has passed', () => {
    const { limiter, advance } = createTestLimiter(2, 60_000);

    limiter.check('a');
    limiter.check('a');
    expect(limiter.check('a').allowed).toBe(false);

    advance(60_001);

    expect(limiter.check('a').allowed).toBe(true);
  });

  it('slides the window rather than resetting it wholesale', () => {
    const { limiter, advance } = createTestLimiter(2, 60_000);

    limiter.check('a');
    advance(30_000);
    limiter.check('a');
    advance(30_001);

    // The first attempt has aged out, the second has not.
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
  });

  it('reports how long to wait before retrying', () => {
    const { limiter, advance } = createTestLimiter(1, 60_000);

    limiter.check('a');
    advance(20_000);

    expect(limiter.check('a')).toEqual({ allowed: false, retryAfterSeconds: 40 });
  });
});

describe('getClientIp', () => {
  it('uses the address the edge proxy vouches for', () => {
    const request = new Request('https://example.test', {
      headers: { 'cf-connecting-ip': '203.0.113.1' },
    });

    expect(getClientIp(request)).toBe('203.0.113.1');
  });

  it('ignores a caller-supplied x-forwarded-for', () => {
    // The whole point of the limiter: a client must not be able to mint itself a fresh
    // bucket by choosing what it sends.
    const spoofed = new Request('https://example.test', {
      headers: { 'x-forwarded-for': '198.51.100.9', 'cf-connecting-ip': '203.0.113.1' },
    });
    const alsoSpoofed = new Request('https://example.test', {
      headers: { 'x-forwarded-for': '198.51.100.10', 'cf-connecting-ip': '203.0.113.1' },
    });

    expect(getClientIp(spoofed)).toBe(getClientIp(alsoSpoofed));
  });

  it('shares one bucket when no trustworthy address is available', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const request = new Request('https://example.test', {
      headers: { 'x-forwarded-for': '198.51.100.9' },
    });

    expect(getClientIp(request)).toBe('unknown');
    // Otherwise the resulting org-wide 429s look like abuse rather than misconfiguration.
    expect(console.warn).toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('shares one bucket when the header is blank', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const request = new Request('https://example.test', {
      headers: { 'cf-connecting-ip': '  ' },
    });

    expect(getClientIp(request)).toBe('unknown');

    vi.restoreAllMocks();
  });
});
