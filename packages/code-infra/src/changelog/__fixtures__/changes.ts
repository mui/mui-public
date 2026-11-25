// eslint-disable-next-line import/extensions
import type { ChangelogChange, ChangelogData } from '../index.mjs';

export interface ChangeFixture extends Partial<Omit<ChangelogChange, 'pullRequest' | 'author'>> {
  /** Number of the pull request, or `null` for a direct commit. */
  number: number | null;
  body?: string;
  author?: Partial<NonNullable<ChangelogChange['author']>> | null;
}

export function createChange({ number, body = '', author, ...change }: ChangeFixture) {
  const title = change.title ?? `Change ${number}`;
  return {
    title,
    message: title,
    sha: String(number ?? 0).padStart(40, '0'),
    url: `https://github.com/mui/test/pull/${number}`,
    labels: [],
    pullRequest: number === null ? null : { number, title, body },
    author:
      author === null
        ? null
        : { login: 'octocat', name: null, association: 'community' as const, ...author },
    createdAt: '2026-01-01T10:00:00Z',
    mergedAt: '2026-01-01T12:00:00Z',
    ...change,
  } satisfies ChangelogChange;
}

export function createData(
  changes: ChangeFixture[],
  data: Partial<ChangelogData> = {},
): ChangelogData {
  return {
    repository: { owner: 'mui', repo: 'test' },
    previous: { ref: 'v1.0.0', sha: 'a'.repeat(40) },
    release: { ref: 'v1.1.0', sha: 'b'.repeat(40) },
    version: '1.1.0',
    date: '2026-01-02T00:00:00.000Z',
    changes: changes.map(createChange),
    packages: [],
    ...data,
  };
}
