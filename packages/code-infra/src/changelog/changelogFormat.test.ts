import { expect, it } from 'vitest';
import { fetchDummyRelease } from './__fixtures__/fetchDummyRelease';
import { createGitHub } from './__fixtures__/github';
import {
  bulletList,
  formatAuthor,
  formatReference,
  groupBy,
  joinBlocks,
  joinWords,
  labelValues,
  readLabels,
  section,
  sortByTitle,
  // eslint-disable-next-line import/extensions
} from './index.mjs';
// eslint-disable-next-line import/extensions
import type { ChangelogData } from './index.mjs';

function formatChangelog(data: ChangelogData, level: string) {
  const groups = groupBy(data.changes, (change) => labelValues(readLabels(change), 'component'));
  return joinBlocks(
    [...groups].map(([component, changes]) =>
      section(
        `${level} ${component}`,
        bulletList(
          sortByTitle(changes).map((change) =>
            joinWords(change.title, `(${formatReference(change)})`, formatAuthor(change.author)),
          ),
        ),
      ),
    ),
  );
}

it('formats what is fetched more than once, also after it was saved', async () => {
  const github = createGitHub({
    commits: [
      {
        message: '[menu] Fix it (#1)',
        pulls: [{ number: 1, labels: ['component: menu'], login: 'octocat' }],
      },
    ],
  });

  const data = await fetchDummyRelease(github);
  const requestCount = github.requests.length;
  const before = structuredClone(data);

  expect(formatChangelog(data, '##')).toBe('## menu\n\n- [menu] Fix it (#1) @octocat');
  expect(formatChangelog(data, '###')).toBe('### menu\n\n- [menu] Fix it (#1) @octocat');
  expect(formatChangelog(JSON.parse(JSON.stringify(data)), '##')).toBe(
    '## menu\n\n- [menu] Fix it (#1) @octocat',
  );
  expect(data).toEqual(before);
  expect(github.requests).toHaveLength(requestCount);
});

it('checks the types of the code that formats', async () => {
  const data = await fetchDummyRelease(createGitHub());

  // @ts-expect-error -- The account may have been deleted.
  expect(data.changes.map((change) => change.author.login)).toEqual([]);
  // @ts-expect-error -- A commit may have landed without a pull request.
  expect(data.changes.map((change) => change.pullRequest.number)).toEqual([]);
  // @ts-expect-error -- Misspelled.
  expect(data.changes.map((change) => change.label)).toEqual([]);
});
