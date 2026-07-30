import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Octokit } from '@octokit/rest';
import type { RowDataPacket } from 'mysql2';
import { getOctokit } from './github';
import { queryStoreDatabase } from './storeDatabase';
import { parseSupportKeyRows, validateSupportKey } from './validateSupport';
import type { SupportKeyRecord } from './validateSupport';

// The two things this module reaches out to: the GitHub API and the store database.
// GitHub is faked at the HTTP boundary below so the real Octokit client is exercised.
vi.mock('./github', () => ({ getOctokit: vi.fn() }));
vi.mock('./storeDatabase', () => ({ queryStoreDatabase: vi.fn() }));

const ACTIVE_KEY: SupportKeyRecord = { active: true, expiresAt: '2030-01-01T00:00:00Z' };

/** Builds rows shaped the way the support key query returns them. */
function supportKeyRows(rows: Record<string, unknown>[]): RowDataPacket[] {
  return rows as RowDataPacket[];
}

/**
 * A real Octokit whose HTTP layer is served from an in-memory label set, so the client's
 * own request building and response parsing stay in the test's path.
 */
function createGitHubStub(initialLabels: string[], status = 200) {
  const labels = new Set(initialLabels);

  const fetchStub: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? 'GET';

    if (status !== 200) {
      return Response.json({ message: 'Boom' }, { status });
    }

    if (method === 'POST') {
      const body: unknown = JSON.parse(String(init?.body));
      if (body && typeof body === 'object' && 'labels' in body && Array.isArray(body.labels)) {
        body.labels.forEach((label) => labels.add(String(label)));
      }
    } else if (method === 'DELETE') {
      labels.delete(decodeURIComponent(url.pathname.split('/labels/')[1]));
    }

    return Response.json([...labels].map((name) => ({ name })));
  };

  const octokit = new Octokit({ auth: 'test-token', request: { fetch: fetchStub } });

  return { octokit, labels };
}

function stubStoreLookup(record: SupportKeyRecord | null) {
  vi.mocked(queryStoreDatabase).mockResolvedValue(record);
}

describe('parseSupportKeyRows', () => {
  it('returns null when the key matched no rows', () => {
    expect(parseSupportKeyRows(supportKeyRows([{ found: 0, expire_at: null, active: null }]))).toBe(
      null,
    );
  });

  it('returns null when there are no rows at all', () => {
    expect(parseSupportKeyRows(supportKeyRows([]))).toBe(null);
  });

  it('returns null when the key matched more than one row', () => {
    expect(
      parseSupportKeyRows(supportKeyRows([{ found: 2, expire_at: '2030-01-01', active: 1 }])),
    ).toBe(null);
  });

  it('reads an active key', () => {
    expect(
      parseSupportKeyRows(supportKeyRows([{ found: 1, expire_at: '2030-01-01', active: 1 }])),
    ).toEqual({ active: true, expiresAt: '2030-01-01' });
  });

  it('reads an expired key', () => {
    expect(
      parseSupportKeyRows(supportKeyRows([{ found: 1, expire_at: '2024-03-07', active: 0 }])),
    ).toEqual({ active: false, expiresAt: '2024-03-07' });
  });
});

describe('validateSupportKey', () => {
  beforeEach(() => {
    vi.mocked(getOctokit).mockReturnValue(createGitHubStub([]).octokit);
  });

  describe('support key lookup', () => {
    it('rejects a key that is not in the store', async () => {
      const { octokit, labels } = createGitHubStub(['support: unknown']);
      vi.mocked(getOctokit).mockReturnValue(octokit);
      stubStoreLookup(null);

      const result = await validateSupportKey({
        repo: 'mui-x',
        issueId: 42,
        supportKey: 'unknown-key',
      });

      expect(result).toEqual({ status: 'error', message: 'Your support key is invalid.' });
      expect([...labels]).toEqual(['support: unknown']);
    });

    it('reports the expiry date for an expired key', async () => {
      stubStoreLookup({ active: false, expiresAt: '2024-03-07T12:00:00Z' });

      const result = await validateSupportKey({
        repo: 'mui-x',
        issueId: 42,
        supportKey: 'expired-key',
      });

      expect(result).toEqual({
        status: 'error',
        message: 'Your support key is invalid. It expired on March 7, 2024.',
      });
    });

    it('propagates a lookup failure instead of blaming the key', async () => {
      vi.mocked(queryStoreDatabase).mockRejectedValue(new Error('bastion unreachable'));

      await expect(
        validateSupportKey({ repo: 'mui-x', issueId: 42, supportKey: 'some-key' }),
      ).rejects.toThrow('bastion unreachable');
    });
  });

  describe('issue labels', () => {
    it('upgrades an unvalidated issue to priority support', async () => {
      const { octokit, labels } = createGitHubStub(['bug', 'support: unknown']);
      vi.mocked(getOctokit).mockReturnValue(octokit);
      stubStoreLookup(ACTIVE_KEY);

      const result = await validateSupportKey({
        repo: 'mui-x',
        issueId: 42,
        supportKey: 'some-key',
      });

      expect(result).toEqual({
        status: 'success',
        message: 'Your GitHub issue #42 was validated. You can now close this page.',
      });
      expect([...labels]).toEqual(['bug', 'support: priority']);
    });

    it('is a no-op for an issue that was already validated', async () => {
      const { octokit, labels } = createGitHubStub(['support: priority']);
      vi.mocked(getOctokit).mockReturnValue(octokit);
      stubStoreLookup(ACTIVE_KEY);

      const result = await validateSupportKey({
        repo: 'mui-x',
        issueId: 42,
        supportKey: 'some-key',
      });

      expect(result).toEqual({
        status: 'success',
        message: 'This GitHub issue was already validated. You can close this page.',
      });
      expect([...labels]).toEqual(['support: priority']);
    });

    it('refuses an issue that is not awaiting validation', async () => {
      const { octokit, labels } = createGitHubStub(['bug']);
      vi.mocked(getOctokit).mockReturnValue(octokit);
      stubStoreLookup(ACTIVE_KEY);

      const result = await validateSupportKey({
        repo: 'mui-x',
        issueId: 42,
        supportKey: 'some-key',
      });

      expect(result).toEqual({
        status: 'error',
        message: `Your ownership of this GitHub issue can't be validated.`,
      });
      expect([...labels]).toEqual(['bug']);
    });

    it('refuses an issue that does not exist', async () => {
      vi.mocked(getOctokit).mockReturnValue(createGitHubStub([], 404).octokit);
      stubStoreLookup(ACTIVE_KEY);

      const result = await validateSupportKey({
        repo: 'mui-x',
        issueId: 42,
        supportKey: 'some-key',
      });

      expect(result).toEqual({
        status: 'error',
        message: `Your ownership of this GitHub issue can't be validated.`,
      });
    });

    it('propagates a GitHub outage instead of blaming the customer', async () => {
      vi.mocked(getOctokit).mockReturnValue(createGitHubStub([], 502).octokit);
      stubStoreLookup(ACTIVE_KEY);

      await expect(
        validateSupportKey({ repo: 'mui-x', issueId: 42, supportKey: 'some-key' }),
      ).rejects.toThrow();
    });
  });
});
