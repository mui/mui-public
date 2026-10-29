// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as core from '@actions/core';
import { context as workflowContext, getOctokit } from '@actions/github';
import orderIdValidation from './orderIdValidation';

const context = {
  ...workflowContext,
  repo: { owner: 'mui', repo: 'mui-x' },
  issue: { owner: 'mui', repo: 'mui-x', number: 42 },
};

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('orderIdValidation', () => {
  it.each([
    { names: ['MUI X Pro', 'MUI X Premium'], plan: 'premium' },
    { names: ['MUI X Premium', 'MUI X Pro'], plan: 'premium' },
    { names: ['MUI X Pro'], plan: 'pro' },
    { names: ['MUI X PREMIUM'], plan: 'premium' },
    { names: ['MUI X Pro to Premium upgrade'], plan: 'premium' },
    { names: ['Design kit', 'MUI X Pro'], plan: 'pro' },
    { names: ['Professional design kit'], plan: null },
    { names: [], plan: null },
  ])('selects $plan for $names', async ({ names, plan }) => {
    vi.stubEnv('ORDER_ID', '123');
    vi.stubEnv('ORDER_API_TOKEN', 'test-order-token');
    vi.stubEnv('GITHUB_REPOSITORY', 'mui/mui-x');
    const orderFetch = vi.fn(async () =>
      Response.json({ line_items: names.map((name) => ({ name })) }),
    );
    vi.stubGlobal('fetch', orderFetch);
    const githubFetch = vi.fn(/** @type {typeof fetch} */ (async () => Response.json([])));
    const github = getOctokit('test-github-token', { request: { fetch: githubFetch } });

    await orderIdValidation({ core, context, github });

    expect(process.exitCode).not.toBe(1);
    expect(orderFetch).toHaveBeenCalledExactlyOnceWith(
      'https://store-wp.mui.com/wp-json/wc/v3/orders/123',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Basic test-order-token' }),
      }),
    );
    expect(
      githubFetch.mock.calls.map(([url, options]) => ({
        url,
        method: options?.method,
        body: options?.body,
      })),
    ).toEqual(
      plan
        ? [
            {
              url: 'https://api.github.com/repos/mui/mui-x/issues/42/labels',
              method: 'POST',
              body: JSON.stringify({ labels: [`support: ${plan} standard`] }),
            },
          ]
        : [],
    );
  });
});
