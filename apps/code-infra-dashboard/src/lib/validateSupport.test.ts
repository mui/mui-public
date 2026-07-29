import { describe, it, expect } from 'vitest';
import { validateSupportKey } from './validateSupport';
import type { SupportKeyRecord, SupportLabelApi } from './validateSupport';

const VALID_KEY = 'valid-key';

/** An in-memory stand-in for the GitHub issues API, tracking the issue's labels. */
function createIssuesApi(initialLabels: string[]) {
  const labels = new Set(initialLabels);

  const api: SupportLabelApi = {
    async listLabelsOnIssue() {
      return { data: [...labels].map((name) => ({ name })) };
    },
    async removeLabel({ name }) {
      labels.delete(name);
      return {};
    },
    async addLabels({ labels: added }) {
      added.forEach((name) => labels.add(name));
      return {};
    },
  };

  return { api, labels };
}

function lookupReturning(record: SupportKeyRecord | null) {
  return async (supportKey: string) => (supportKey === VALID_KEY ? record : null);
}

const ACTIVE_KEY = lookupReturning({ active: true, expiresAt: '2030-01-01T00:00:00Z' });

describe('validateSupportKey', () => {
  describe('input validation', () => {
    it('asks for a support key when none was provided', async () => {
      const result = await validateSupportKey(
        { repo: 'test-repo', issueId: 42, supportKey: '' },
        { lookupSupportKey: ACTIVE_KEY },
      );

      expect(result).toEqual({ status: 'error', message: 'Provide your support key above.' });
    });

    it('reports a missing issue id', async () => {
      const result = await validateSupportKey(
        { repo: 'test-repo', issueId: 0, supportKey: VALID_KEY },
        { lookupSupportKey: ACTIVE_KEY },
      );

      expect(result).toEqual({ status: 'error', message: 'Missing issue id.' });
    });

    it('reports a missing repository', async () => {
      const result = await validateSupportKey(
        { repo: '', issueId: 42, supportKey: VALID_KEY },
        { lookupSupportKey: ACTIVE_KEY },
      );

      expect(result).toEqual({ status: 'error', message: 'Missing repository.' });
    });
  });

  describe('support key lookup', () => {
    it('rejects a key that is not in the store', async () => {
      const { api, labels } = createIssuesApi(['support: unknown']);

      const result = await validateSupportKey(
        { repo: 'test-repo', issueId: 42, supportKey: 'unknown-key' },
        { lookupSupportKey: lookupReturning(null), issues: api },
      );

      expect(result).toEqual({ status: 'error', message: 'Your support key is invalid.' });
      expect([...labels]).toEqual(['support: unknown']);
    });

    it('reports the expiry date for an expired key', async () => {
      const result = await validateSupportKey(
        { repo: 'test-repo', issueId: 42, supportKey: VALID_KEY },
        {
          lookupSupportKey: lookupReturning({ active: false, expiresAt: '2024-03-07T12:00:00Z' }),
          issues: createIssuesApi(['support: unknown']).api,
        },
      );

      expect(result).toEqual({
        status: 'error',
        message: 'Your support key is invalid. It expired on March 7, 2024.',
      });
    });

    it('propagates a lookup failure instead of blaming the key', async () => {
      const outage = new Error('bastion unreachable');

      await expect(
        validateSupportKey(
          { repo: 'test-repo', issueId: 42, supportKey: VALID_KEY },
          {
            lookupSupportKey: async () => {
              throw outage;
            },
          },
        ),
      ).rejects.toThrow('bastion unreachable');
    });
  });

  describe('issue labels', () => {
    it('upgrades an unvalidated issue to priority support', async () => {
      const { api, labels } = createIssuesApi(['bug', 'support: unknown']);

      const result = await validateSupportKey(
        { repo: 'test-repo', issueId: 42, supportKey: VALID_KEY },
        { lookupSupportKey: ACTIVE_KEY, issues: api },
      );

      expect(result).toEqual({
        status: 'success',
        message: 'Your GitHub issue #42 was validated. You can now close this page.',
      });
      expect([...labels]).toEqual(['bug', 'support: priority']);
    });

    it('is a no-op for an issue that was already validated', async () => {
      const { api, labels } = createIssuesApi(['support: priority']);

      const result = await validateSupportKey(
        { repo: 'test-repo', issueId: 42, supportKey: VALID_KEY },
        { lookupSupportKey: ACTIVE_KEY, issues: api },
      );

      expect(result).toEqual({
        status: 'success',
        message: 'This GitHub issue was already validated. You can close this page.',
      });
      expect([...labels]).toEqual(['support: priority']);
    });

    it('refuses an issue that does not exist', async () => {
      const notFound = Object.assign(new Error('Not Found'), { status: 404 });
      const issues: SupportLabelApi = {
        async listLabelsOnIssue() {
          throw notFound;
        },
        async removeLabel() {
          return {};
        },
        async addLabels() {
          return {};
        },
      };

      const result = await validateSupportKey(
        { repo: 'test-repo', issueId: 42, supportKey: VALID_KEY },
        { lookupSupportKey: ACTIVE_KEY, issues },
      );

      expect(result).toEqual({
        status: 'error',
        message: `Your ownership of this GitHub issue can't be validated.`,
      });
    });

    it('propagates a GitHub outage instead of blaming the customer', async () => {
      const issues: SupportLabelApi = {
        async listLabelsOnIssue() {
          throw Object.assign(new Error('Bad Gateway'), { status: 502 });
        },
        async removeLabel() {
          return {};
        },
        async addLabels() {
          return {};
        },
      };

      await expect(
        validateSupportKey(
          { repo: 'test-repo', issueId: 42, supportKey: VALID_KEY },
          { lookupSupportKey: ACTIVE_KEY, issues },
        ),
      ).rejects.toThrow('Bad Gateway');
    });

    it('refuses an issue that is not awaiting validation', async () => {
      const { api, labels } = createIssuesApi(['bug']);

      const result = await validateSupportKey(
        { repo: 'test-repo', issueId: 42, supportKey: VALID_KEY },
        { lookupSupportKey: ACTIVE_KEY, issues: api },
      );

      expect(result).toEqual({
        status: 'error',
        message: `Your ownership of this GitHub issue can't be validated.`,
      });
      expect([...labels]).toEqual(['bug']);
    });
  });
});
