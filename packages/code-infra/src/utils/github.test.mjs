import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRateLimitRetryTime } from './github.mjs';

const NOW = new Date('2026-10-08T10:00:00Z').getTime();

/**
 * @param {number} status
 * @param {Record<string, string>} headers
 * @param {string} [message]
 */
function requestError(status, headers, message = 'Forbidden') {
  return Object.assign(new Error(message), { status, response: { headers } });
}

describe('getRateLimitRetryTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses retry-after', () => {
    expect(getRateLimitRetryTime(requestError(429, { 'retry-after': '300' }))).toEqual(
      new Date(NOW + 300_000),
    );
  });

  it('uses x-ratelimit-reset when the primary limit is exhausted', () => {
    const reset = NOW / 1000 + 17 * 60;
    expect(
      getRateLimitRetryTime(
        requestError(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }),
      ),
    ).toEqual(new Date(reset * 1000));
  });

  it('waits at least one minute', () => {
    expect(
      getRateLimitRetryTime(
        requestError(403, { 'retry-after': '1' }, 'You have exceeded a secondary rate limit'),
      ),
    ).toEqual(new Date(NOW + 60_000));
    expect(
      getRateLimitRetryTime(requestError(403, {}, 'You have exceeded a secondary rate limit')),
    ).toEqual(new Date(NOW + 60_000));
  });

  it('returns null for other errors', () => {
    expect(getRateLimitRetryTime(requestError(403, {}, 'Resource not accessible'))).toBe(null);
    expect(getRateLimitRetryTime(requestError(500, { 'retry-after': '1' }))).toBe(null);
    expect(getRateLimitRetryTime(new Error('boom'))).toBe(null);
    expect(getRateLimitRetryTime(null)).toBe(null);
  });
});
