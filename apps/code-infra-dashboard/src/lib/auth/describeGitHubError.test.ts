import { inspect } from 'node:util';
import { vi, describe, it, expect, afterEach } from 'vitest';
import { exchangeWebFlowCode } from '@octokit/oauth-methods';
import { describeGitHubError } from './describeGitHubError';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function failedCodeExchange(response: Response): Promise<unknown> {
  const fakeFetch: typeof fetch = async () => response;
  vi.stubGlobal('fetch', fakeFetch);
  try {
    await exchangeWebFlowCode({
      clientType: 'github-app',
      clientId: 'client-id',
      clientSecret: 'very-secret-value',
      code: 'used-code',
    });
  } catch (error) {
    return error;
  }
  throw new Error('Expected the code exchange to fail.');
}

describe('describeGitHubError', () => {
  it('keeps the client secret that the raw error carries out of the summary', async () => {
    const error = await failedCodeExchange(
      Response.json({ message: 'Server Error' }, { status: 502 }),
    );

    // Logging the error itself is what leaked the secret.
    expect(inspect(error, { depth: 10 })).toContain('very-secret-value');
    expect(describeGitHubError(error)).not.toContain('very-secret-value');
    expect(describeGitHubError(error)).toContain('502');
  });

  it("keeps GitHub's OAuth error code for a refused code", async () => {
    const error = await failedCodeExchange(
      Response.json({
        error: 'bad_verification_code',
        error_description: 'The code passed is incorrect or expired.',
      }),
    );

    expect(describeGitHubError(error)).toContain('bad_verification_code');
    expect(describeGitHubError(error)).not.toContain('very-secret-value');
  });

  it('describes failures that are not HTTP errors', () => {
    expect(describeGitHubError(new TypeError('fetch failed'))).toBe('fetch failed');
  });
});
