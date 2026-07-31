import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Octokit } from '@octokit/rest';
import type { RowDataPacket, QueryResult, QueryOptions, ExecuteValues, FieldPacket } from 'mysql2';
import { getOctokit } from './github';
import { queryStoreDatabase } from './storeDatabase';
import type { StoreConnection } from './storeDatabase';
import { parseSupportKeyRows, validateSupportKey } from './validateSupport';

// The two things this module reaches out to: the GitHub API and the store database.
// Both are faked at their own boundary below, so the real Octokit client and the real
// query callback stay in the test's path.
vi.mock('./github', () => ({ getOctokit: vi.fn() }));
vi.mock('./storeDatabase', () => ({ queryStoreDatabase: vi.fn() }));

/** Builds rows shaped the way the support key query returns them. */
function supportKeyRows(rows: Record<string, unknown>[]): RowDataPacket[] {
  return rows as RowDataPacket[];
}

/** Rows for a key the store knows about, active unless told otherwise. */
function knownKeyRows(
  { expiresAt, active }: { expiresAt: string | null; active: number | null } = {
    expiresAt: '2030-01-01T00:00:00Z',
    active: 1,
  },
) {
  return [{ found: 1, expire_at: expiresAt, active }];
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

interface StoreQuery {
  sql: string;
  values: ExecuteValues | undefined;
}

/**
 * Serves the support key query from canned rows. The callback runs for real, so the
 * query string, the bound parameter and the row parsing all stay in the test's path.
 * `execute` is written against mysql2's own signature, so a change to it stops
 * compiling here rather than drifting silently.
 */
function stubStoreRows(rows: Record<string, unknown>[]) {
  const queries: StoreQuery[] = [];

  const connection: StoreConnection = {
    async execute<T extends QueryResult>(
      sql: string | QueryOptions,
      values?: ExecuteValues,
    ): Promise<[T, FieldPacket[]]> {
      queries.push({ sql: typeof sql === 'string' ? sql : sql.sql, values });
      // The row shape is the caller's to declare; only it knows what the query selects.
      return [supportKeyRows(rows) as T, []];
    },
  };

  vi.mocked(queryStoreDatabase).mockImplementation(async (run) => run(connection));

  return { queries };
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

  it('treats a key with no expiry date as active', () => {
    // `expire_at > now()` is SQL NULL rather than 0 when there is no date to compare.
    expect(
      parseSupportKeyRows(supportKeyRows([{ found: 1, expire_at: null, active: null }])),
    ).toEqual({ active: true, expiresAt: null });
  });
});

describe('validateSupportKey', () => {
  beforeEach(() => {
    vi.mocked(getOctokit).mockReturnValue(createGitHubStub([]).octokit);
    stubStoreRows(knownKeyRows());
  });

  describe('support key lookup', () => {
    it('looks the key up as a bound parameter', async () => {
      const { queries } = stubStoreRows(knownKeyRows());

      await validateSupportKey({ repo: 'mui-x', issueId: 42, supportKey: 'some-key' });

      expect(queries).toHaveLength(1);
      expect(queries[0].sql).toContain('wp3u_x_addons');
      // Bound, not interpolated into the statement.
      expect(queries[0].values).toEqual(['some-key']);
      expect(queries[0].sql).not.toContain('some-key');
    });

    it('rejects a key that is not in the store', async () => {
      const { octokit, labels } = createGitHubStub(['support: unknown']);
      vi.mocked(getOctokit).mockReturnValue(octokit);
      stubStoreRows([{ found: 0, expire_at: null, active: null }]);

      const result = await validateSupportKey({
        repo: 'mui-x',
        issueId: 42,
        supportKey: 'unknown-key',
      });

      expect(result).toEqual({ status: 'error', message: 'Your support key is invalid.' });
      expect([...labels]).toEqual(['support: unknown']);
    });

    it('reports the expiry date for an expired key', async () => {
      stubStoreRows(knownKeyRows({ expiresAt: '2024-03-07T12:00:00Z', active: 0 }));

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

    it('never reports an unusable expiry date as a date', async () => {
      stubStoreRows(knownKeyRows({ expiresAt: null, active: 0 }));

      const result = await validateSupportKey({
        repo: 'mui-x',
        issueId: 42,
        supportKey: 'expired-key',
      });

      expect(result).toEqual({ status: 'error', message: 'Your support key is invalid.' });
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
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(getOctokit).mockReturnValue(createGitHubStub([], 404).octokit);

      const result = await validateSupportKey({
        repo: 'mui-x',
        issueId: 42,
        supportKey: 'some-key',
      });

      expect(result).toEqual({
        status: 'error',
        message: `Your ownership of this GitHub issue can't be validated.`,
      });
      // A 404 is also what a missing Issues permission looks like, so it has to be logged.
      expect(console.error).toHaveBeenCalled();
    });

    it('propagates a GitHub outage instead of blaming the customer', async () => {
      vi.mocked(getOctokit).mockReturnValue(createGitHubStub([], 502).octokit);

      await expect(
        validateSupportKey({ repo: 'mui-x', issueId: 42, supportKey: 'some-key' }),
      ).rejects.toThrow();
    });
  });
});
