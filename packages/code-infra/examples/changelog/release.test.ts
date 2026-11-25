import { expect, it } from 'vitest';
import { fetchDummyRelease } from '../../src/changelog/__fixtures__/fetchDummyRelease';
import { createGitHub } from '../../src/changelog/__fixtures__/github';
// eslint-disable-next-line import/extensions
import { formatChangelog, formatDocsPage } from './base-ui.mjs';

it('renders what is fetched more than once, also after it was saved', async () => {
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
  const markdown = formatChangelog(data);

  expect(markdown).toContain('### Menu\n\n- Fix it (#1) by @octocat');
  expect(formatDocsPage(data)).toContain(
    '## Menu\n\n- Fix it ([#1](https://github.com/mui/test/pull/1))',
  );
  expect(formatChangelog(JSON.parse(JSON.stringify(data)))).toBe(markdown);
  expect(data).toEqual(before);
  expect(github.requests).toHaveLength(requestCount);
});

it('checks the types of the code that renders', async () => {
  const data = await fetchDummyRelease(createGitHub());

  // @ts-expect-error -- The account may have been deleted.
  expect(data.changes.map((change) => change.author.login)).toEqual([]);
  // @ts-expect-error -- A commit may have landed without a pull request.
  expect(data.changes.map((change) => change.pullRequest.number)).toEqual([]);
  // @ts-expect-error -- Misspelled.
  expect(data.changes.map((change) => change.label)).toEqual([]);
});
