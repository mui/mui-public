import { vi } from 'vitest';
import { DASHBOARD_ORIGIN } from '@/constants';

/**
 * Test fixtures for the environment GitHub sign-in reads. Pair either with
 * `vi.unstubAllEnvs()` after each test.
 */

/** A deploy with sign-in configured, as production. */
export function stubConfiguredDeploy() {
  vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', 'client-id');
  vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', 'client-secret');
  vi.stubEnv('SESSION_SECRET', 'a-session-secret-of-thirty-two-chars');
  vi.stubEnv('DASHBOARD_ORIGIN', DASHBOARD_ORIGIN);
}

/** A deploy without sign-in, whatever the shell running the tests has set. */
export function stubUnconfiguredDeploy() {
  vi.stubEnv('DASHBOARD_ORIGIN', undefined);
  vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', undefined);
  vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', undefined);
  vi.stubEnv('SESSION_SECRET', undefined);
}
