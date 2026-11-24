import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchDummyRelease } from './__fixtures__/fetchDummyRelease';
import type { GitHubFixture, PullFixture, ResponseFixture } from './__fixtures__/github';
import { createGitHub, FORBIDDEN } from './__fixtures__/github';

let warnings: string[];

beforeEach(() => {
  warnings = [];
  const spy = vi.spyOn(console, 'warn').mockImplementation((message) => warnings.push(message));
  return () => spy.mockRestore();
});

describe('pull request authors', () => {
  it('are classified', async () => {
    const associations = ['MEMBER', 'CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR'];
    const github = createGitHub({
      commits: associations.map((association, index) => ({
        message: `Commit ${index}`,
        pulls: [{ number: index, association }],
      })),
    });

    const { changes } = await fetchDummyRelease(github);

    expect(changes.map((change) => change.author?.association)).toEqual([
      'team',
      'community',
      'first-timer',
    ]);
  });
});

describe('cherry-pick authors', () => {
  const ORIGINAL: PullFixture = { number: 10, login: 'octocat' };
  const BOT = { login: 'github-actions[bot]', name: null, association: 'community' };
  const OCTOCAT = { login: 'octocat', name: null, association: 'community' };

  async function changeOf(pull: Partial<PullFixture>, pulls: PullFixture[] = [ORIGINAL]) {
    const github = createGitHub({
      commits: [
        {
          message: `${pull.title ?? 'Fix it'} (#1)`,
          pulls: [{ number: 1, login: 'github-actions[bot]', ...pull }],
        },
      ],
      pulls,
    });
    return (await fetchDummyRelease(github)).changes[0];
  }

  it('credits the original author', async () => {
    const change = await changeOf({
      title: 'Fix it (#9) (@octocat)',
      body: 'Cherry-pick of #10',
      labels: ['cherry-pick'],
    });

    expect(change).toMatchObject({ title: 'Fix it (#9)', author: OCTOCAT });
    expect(warnings).toEqual([]);
  });

  it.each(['mui/other#10', 'https://github.com/mui/other/pull/10'])(
    'credits the original author across repositories in %s',
    async (reference) => {
      const change = await changeOf({ body: `Cherry-pick of ${reference}` }, [
        // Same number in this repository.
        { number: 10, login: 'someone-else' },
        // Being new to the other repository doesn't make someone new to this one.
        { ...ORIGINAL, repository: 'mui/other', association: 'FIRST_TIME_CONTRIBUTOR' },
      ]);

      expect(change.author).toEqual(OCTOCAT);
    },
  );

  it.each<[string, Partial<PullFixture>, PullFixture[]]>([
    ['the original does not exist', { body: 'Cherry-pick of #10' }, []],
    [
      'the originals have different authors',
      { body: 'Cherry-pick of #10 and #11' },
      [ORIGINAL, { number: 11, login: 'hubot' }],
    ],
    ['only the title names an author', { title: 'Fix it (@octocat)', labels: ['cherry-pick'] }, []],
  ])('keeps the bot, with a warning, when %s', async (reason, pull, originals) => {
    const change = await changeOf(pull, originals);

    expect(change.author).toEqual(BOT);
    expect(change.title).toBe(pull.title ?? 'Fix it');
    expect(warnings).toEqual([
      "#1 is a cherry-pick, but its original author can't be determined. github-actions[bot] is credited instead.",
    ]);
  });

  it('does not take a changelog quoted in a dependency bump for a cherry-pick', async () => {
    const change = await changeOf({
      login: 'renovate[bot]',
      body: '- Cherry-pick of [#10](https://example.com)\n> Cherry-pick of #10',
    });

    expect(change.author?.login).toBe('renovate[bot]');
    expect(warnings).toEqual([]);
  });

  it('keeps the person who opened it', async () => {
    const change = await changeOf({
      login: 'maintainer',
      association: 'MEMBER',
      body: 'Cherry-pick of #10',
      labels: ['cherry-pick'],
    });

    expect(change.author).toEqual({ login: 'maintainer', name: null, association: 'team' });
    expect(warnings).toEqual([]);
  });
});

describe('direct commit authors', () => {
  async function fetchAuthors(fixture: GitHubFixture) {
    const github = createGitHub(fixture);
    const { changes } = await fetchDummyRelease(github, { includeDirectCommits: true });
    return { authors: changes.map((change) => change.author), requests: github.requests };
  }

  it('credits members of the organization as team, asking once for each', async () => {
    const { authors, requests } = await fetchAuthors({
      commits: [
        { message: 'First', login: 'member' },
        { message: 'Second', login: 'outsider' },
        { message: 'Third', login: 'member' },
        { message: 'No account' },
      ],
      responses: { '/orgs/mui/members/member': { status: 204 } },
    });

    expect(authors).toMatchObject([
      { login: 'member', association: 'team' },
      { login: 'outsider', association: 'community' },
      { login: 'member', association: 'team' },
      { login: null, name: 'Git Author', association: 'community' },
    ]);
    expect(requests.filter((path) => path.startsWith('/orgs/'))).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it.each<[string, ResponseFixture]>([
    ['denied', FORBIDDEN],
    [
      'limited to public members',
      {
        status: 404,
        body: { message: 'Not Found' },
        url: 'https://api.github.com/orgs/mui/public_members/someone',
      },
    ],
  ])('warns once and credits community when the check is %s', async (name, response) => {
    const { authors } = await fetchAuthors({
      commits: [
        { message: 'First', login: 'one' },
        { message: 'Second', login: 'two' },
      ],
      responses: { '/orgs/mui/members/one': response, '/orgs/mui/members/two': response },
    });

    expect(authors).toMatchObject([{ association: 'community' }, { association: 'community' }]);
    expect(warnings).toEqual([
      expect.stringMatching(/^The token can't read the private members of mui\./),
    ]);
  });
});
