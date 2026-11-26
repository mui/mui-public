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

  it('tells bots, whatever they are called', async () => {
    const github = createGitHub({
      commits: ['renovate[bot]', 'some-app', 'octocat'].map((login, index) => ({
        message: `Commit ${index}`,
        pulls: [{ number: index, login, isBot: login !== 'octocat' }],
      })),
    });

    const { changes } = await fetchDummyRelease(github);

    expect(changes.map((change) => change.author?.isBot)).toEqual([true, true, false]);
    expect(changes.map((change) => change.pullRequest?.openedBy?.isBot)).toEqual([
      true,
      true,
      false,
    ]);
  });
});

describe('Copilot', () => {
  const COPILOT = { login: 'Copilot', name: null, association: 'community', isBot: false };
  const REQUESTER = { login: 'member', name: null, association: 'team', isBot: false };

  async function fetchChanges(fixture: GitHubFixture) {
    const { changes } = await fetchDummyRelease(
      createGitHub({ responses: { '/orgs/mui/members/member': { status: 204 } }, ...fixture }),
    );
    return changes;
  }

  it('opens pull requests that are credited to who asked for them', async () => {
    const [change] = await fetchChanges({
      commits: [
        {
          message: 'Add it',
          pulls: [{ number: 1, login: 'Copilot', assignees: ['member', 'Copilot'] }],
        },
      ],
    });

    expect(change).toMatchObject({ author: REQUESTER, pullRequest: { openedBy: COPILOT } });
    expect(warnings).toEqual([]);
  });

  it.each([
    ['nobody else', ['Copilot']],
    ['several people', ['member', 'octocat', 'Copilot']],
  ])('is credited, with a warning, when %s is assigned', async (name, assignees) => {
    const [change] = await fetchChanges({
      commits: [{ message: 'Add it', pulls: [{ number: 1, login: 'Copilot', assignees }] }],
    });

    expect(change).toMatchObject({ author: COPILOT, pullRequest: { openedBy: COPILOT } });
    expect(warnings).toEqual([
      "#1 is by Copilot, but who it worked for can't be determined. Copilot is credited instead.",
    ]);
  });

  it('is the only one that assignees are credited for', async () => {
    const changes = await fetchChanges({
      commits: [
        { message: 'Fix it', pulls: [{ number: 1, login: 'octocat', assignees: ['member'] }] },
        {
          message: 'Bump it',
          pulls: [{ number: 2, login: 'renovate[bot]', assignees: ['member'] }],
        },
      ],
    });

    expect(changes.map((change) => change.author?.login)).toEqual(['octocat', 'renovate[bot]']);
  });

  it.each(['github-actions[bot]', 'contributor'])(
    'credits who asked for the original of a cherry-pick by %s',
    async (login) => {
      const [change] = await fetchChanges({
        commits: [
          { message: 'Add it (#1)', pulls: [{ number: 1, login, body: 'Cherry-pick of #10' }] },
        ],
        pulls: [{ number: 10, login: 'Copilot', assignees: ['member', 'Copilot'] }],
      });

      expect(change.author).toEqual(REQUESTER);
      expect(change.pullRequest?.openedBy?.login).toBe(login);
    },
  );
});

describe('cherry-pick authors', () => {
  const ORIGINAL: PullFixture = { number: 10, login: 'octocat' };
  const BOT = { login: 'github-actions[bot]', name: null, association: 'community', isBot: true };
  const OCTOCAT = { login: 'octocat', name: null, association: 'community', isBot: false };

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

    expect(change).toMatchObject({
      title: 'Fix it (#9)',
      author: OCTOCAT,
      pullRequest: { openedBy: BOT },
    });
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

  it('credits a bot for the original it opened', async () => {
    const change = await changeOf({ body: 'Cherry-pick of #10' }, [
      { number: 10, login: 'renovate[bot]' },
    ]);

    expect(change.author?.login).toBe('renovate[bot]');
    expect(warnings).toEqual([]);
  });

  describe('opened by a person', () => {
    const PERSON: Partial<PullFixture> = { login: 'maintainer', association: 'MEMBER' };
    const MAINTAINER = { login: 'maintainer', name: null, association: 'team', isBot: false };

    it('credits the original author', async () => {
      const change = await changeOf({
        ...PERSON,
        title: 'Fix it (@octocat) (#10)',
        body: 'Cherry-pick of https://github.com/mui/test/pull/10',
      });

      expect(change).toMatchObject({ title: 'Fix it', author: OCTOCAT });
      expect(warnings).toEqual([]);
    });

    it.each<[string, PullFixture[]]>([
      ['the original is by a bot', [{ number: 10, login: 'renovate[bot]' }]],
      ['the original does not exist', []],
      [
        'the original author is unknown',
        [{ number: 10, login: 'github-actions[bot]', labels: ['cherry-pick'] }],
      ],
    ])('keeps the person, without a warning, when %s', async (reason, originals) => {
      const change = await changeOf(
        {
          ...PERSON,
          title: 'Fix it (@octocat)',
          body: 'Cherry-pick of #10',
          labels: ['cherry-pick'],
        },
        originals,
      );

      expect(change).toMatchObject({ title: 'Fix it (@octocat)', author: MAINTAINER });
      expect(warnings).toEqual([]);
    });

    it('keeps the person when no original is named', async () => {
      const change = await changeOf({ ...PERSON, body: 'See #10', labels: ['cherry-pick'] });

      expect(change.author).toEqual(MAINTAINER);
      expect(warnings).toEqual([]);
    });
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
        { message: 'Bot', login: 'renovate[bot]' },
        { message: 'Copilot', login: 'Copilot' },
      ],
      responses: { '/orgs/mui/members/member': { status: 204 } },
    });

    expect(authors).toMatchObject([
      { login: 'member', association: 'team', isBot: false },
      { login: 'outsider', association: 'community', isBot: false },
      { login: 'member', association: 'team', isBot: false },
      { login: null, name: 'Git Author', association: 'community', isBot: false },
      { login: 'renovate[bot]', association: 'community', isBot: true },
      { login: 'Copilot', association: 'community', isBot: false },
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

describe('excluded bots', () => {
  it('leave out what they authored or opened', async () => {
    const github = createGitHub({
      commits: [
        { message: 'Bump it', pulls: [{ number: 1, login: 'renovate[bot]' }] },
        {
          message: 'Bump it on v1',
          pulls: [{ number: 2, login: 'github-actions[bot]', body: 'Cherry-pick of #10' }],
        },
        { message: 'Fix it', pulls: [{ number: 3, login: 'octocat' }] },
        {
          message: 'Fix it on v1',
          pulls: [{ number: 4, login: 'backport[bot]', body: 'Cherry-pick of #11' }],
        },
        { message: 'Lock it', login: 'renovate[bot]' },
        { message: 'Tidy it', login: 'octocat' },
      ],
      pulls: [
        { number: 10, login: 'renovate[bot]' },
        { number: 11, login: 'octocat' },
      ],
    });

    const { changes } = await fetchDummyRelease(github, {
      includeDirectCommits: true,
      excludeBots: ['renovate[bot]', 'backport[bot]'],
    });

    expect(changes.map((change) => change.title)).toEqual(['Pull request 3', 'Tidy it']);
  });
});
