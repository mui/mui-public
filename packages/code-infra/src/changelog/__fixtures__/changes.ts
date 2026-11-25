// eslint-disable-next-line import/extensions
import type { ChangelogChange } from '../index.mjs';

interface ChangeFixture extends Partial<Omit<ChangelogChange, 'pullRequest' | 'author'>> {
  /** Number of the pull request, or `null` for a direct commit. */
  number: number | null;
  author?: Partial<NonNullable<ChangelogChange['author']>> | null;
}

export function createChange({ number, author, ...change }: ChangeFixture) {
  const title = change.title ?? `Change ${number}`;
  return {
    title,
    message: title,
    sha: String(number ?? 0).padStart(40, '0'),
    url: `https://github.com/mui/test/pull/${number}`,
    labels: [],
    isBreakingChange: false,
    pullRequest: number === null ? null : { number, title, body: '' },
    author:
      author === null
        ? null
        : { login: 'octocat', name: null, association: 'community' as const, ...author },
    createdAt: '2026-01-01T10:00:00Z',
    mergedAt: '2026-01-01T12:00:00Z',
    ...change,
  } satisfies ChangelogChange;
}
