import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { Octokit } from '@octokit/rest';

import { persistentAuthStrategy } from '../utils/github.mjs';

const ThrottledOctokit = Octokit.plugin(throttling, retry);

/**
 * Waits out short rate limits. Longer ones fail with the original error.
 *
 * @param {number} retryAfter - Seconds until the request may be retried
 * @param {unknown} options
 * @param {unknown} octokit
 * @param {number} retryCount
 * @returns {boolean}
 */
function shouldRetryRateLimit(retryAfter, options, octokit, retryCount) {
  return retryAfter <= 60 && retryCount < 3;
}

/**
 * A client that authenticates as the developer running it.
 *
 * @returns {Octokit}
 */
export function createOctokit() {
  return new ThrottledOctokit({
    authStrategy: persistentAuthStrategy,
    throttle: {
      onRateLimit: shouldRetryRateLimit,
      onSecondaryRateLimit: shouldRetryRateLimit,
    },
  });
}
