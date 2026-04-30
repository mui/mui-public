import { vi, describe, it, expect, beforeEach } from 'vitest';
import { getOctokit } from '@/lib/github';
import { upsertPrComment } from './prComment';

vi.mock('@/lib/github', () => ({
  getOctokit: vi.fn(),
}));

const mockGetOctokit = vi.mocked(getOctokit);

const mockOctokit = {
  issues: {
    listComments: vi.fn().mockResolvedValue({ data: [] }),
    createComment: vi.fn().mockResolvedValue({}),
    updateComment: vi.fn().mockResolvedValue({}),
  },
};

mockGetOctokit.mockReturnValue(mockOctokit as any);

describe('upsertPrComment', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetOctokit.mockReturnValue(mockOctokit as any);
    mockOctokit.issues.listComments.mockResolvedValue({ data: [] });
    mockOctokit.issues.createComment.mockResolvedValue({});
    mockOctokit.issues.updateComment.mockResolvedValue({});
  });

  it('should serialize concurrent calls for the same PR', async () => {
    const callOrder: string[] = [];

    const { promise: firstCallBlocked, resolve: resolveFirst } = Promise.withResolvers<void>();

    mockOctokit.issues.createComment
      .mockImplementationOnce(async () => {
        callOrder.push('first:start');
        await firstCallBlocked;
        callOrder.push('first:end');
        return {};
      })
      .mockImplementationOnce(async () => {
        callOrder.push('second:start');
        callOrder.push('second:end');
        return {};
      });

    const first = upsertPrComment('mui/material-ui', 42, 'report 1');
    const second = upsertPrComment('mui/material-ui', 42, 'report 2');

    resolveFirst();
    await first;
    await second;

    expect(callOrder).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('should allow concurrent calls for different PRs to run in parallel', async () => {
    const callOrder: string[] = [];

    const { promise: firstCallBlocked, resolve: resolveFirst } = Promise.withResolvers<void>();

    mockOctokit.issues.createComment
      .mockImplementationOnce(async () => {
        callOrder.push('pr1:start');
        await firstCallBlocked;
        callOrder.push('pr1:end');
        return {};
      })
      .mockImplementationOnce(async () => {
        callOrder.push('pr2:start');
        callOrder.push('pr2:end');
        return {};
      });

    const first = upsertPrComment('mui/material-ui', 1, 'report 1');
    const second = upsertPrComment('mui/material-ui', 2, 'report 2');

    resolveFirst();
    await first;
    await second;

    expect(callOrder).toEqual(['pr1:start', 'pr2:start', 'pr2:end', 'pr1:end']);
  });

  it('should not poison the queue when a call fails', async () => {
    mockOctokit.issues.createComment
      .mockRejectedValueOnce(new Error('GitHub API error'))
      .mockResolvedValueOnce({});

    const first = upsertPrComment('mui/material-ui', 42, 'report 1');
    const second = upsertPrComment('mui/material-ui', 42, 'report 2');

    await expect(first).rejects.toThrow('GitHub API error');
    await expect(second).resolves.toBeUndefined();
  });
});
