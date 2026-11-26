import { mapAsync } from 'es-toolkit/array';

import { getRateLimitRetryTime } from '../utils/github.mjs';

/**
 * @typedef {import('@octokit/rest').Octokit} Octokit
 * @typedef {import('./types.ts').GitHubRepository} GitHubRepository
 * @typedef {import('./types.ts').ChangelogAuthor} ChangelogAuthor
 * @typedef {import('./types.ts').ChangelogChange} ChangelogChange
 * @typedef {Awaited<ReturnType<Octokit['repos']['compareCommitsWithBasehead']>>['data']['commits'][number]} Commit
 */

/**
 * What is needed from a pull request. Listing and getting one return different supersets of this.
 *
 * @typedef {Object} PullRequest
 * @property {number} number
 * @property {string} title
 * @property {string | null} body
 * @property {{ login: string, type: string } | null} user
 * @property {{ login: string, type: string }[] | null} [assignees]
 * @property {string} author_association
 * @property {{ name?: string }[]} labels
 */

/** @type {Record<string, ChangelogAuthor['association']>} */
const ASSOCIATIONS = {
  OWNER: 'team',
  MEMBER: 'team',
  COLLABORATOR: 'community',
  CONTRIBUTOR: 'community',
  FIRST_TIMER: 'first-timer',
  FIRST_TIME_CONTRIBUTOR: 'first-timer',
  MANNEQUIN: 'first-timer',
  NONE: 'first-timer',
};

const BREAKING_CHANGE_LABELS = ['breaking', 'breaking change'];
const CHERRY_PICK_LABEL = 'cherry-pick';
const COPILOT = 'Copilot';
const PULL_REFERENCE =
  /(?:https:\/\/github\.com\/(?<urlOwner>[\w.-]+)\/(?<urlRepo>[\w.-]+)\/pull\/|(?:(?<owner>[\w.-]+)\/(?<repo>[\w.-]+))?#)(?<number>\d+)/;
// Unnamed, so that the pattern can be repeated.
const ANY_PULL_REFERENCE = PULL_REFERENCE.source.replaceAll(/\(\?<\w+>/g, '(?:');
// Anchored to the start of a line: changelogs quoted in dependency bumps mention cherry-picks too.
const CHERRY_PICK_LINE = new RegExp(
  `^cherry[- ]pick(?:ed|s)?(?: of| from)?:? (${ANY_PULL_REFERENCE}(?:(?:,? and |, ?| )${ANY_PULL_REFERENCE})*)`,
  'gim',
);

/**
 * @param {PullRequest} pull
 * @param {GitHubRepository} repository - Where the pull request is
 * @returns {(GitHubRepository & { number: number, text: string })[]}
 */
function getCherryPickReferences(pull, repository) {
  return [...(pull.body ?? '').matchAll(CHERRY_PICK_LINE)].flatMap(([, references]) =>
    [...references.matchAll(new RegExp(PULL_REFERENCE, 'g'))].map(({ groups = {} }) => {
      const owner = groups.urlOwner ?? groups.owner ?? repository.owner;
      const repo = groups.urlRepo ?? groups.repo ?? repository.repo;
      const isSameRepository = owner === repository.owner && repo === repository.repo;
      return {
        owner,
        repo,
        number: Number(groups.number),
        // As written in a title, also when the body has a link.
        text: isSameRepository ? `#${groups.number}` : `${owner}/${repo}#${groups.number}`,
      };
    }),
  );
}

/**
 * Copilot works for a person, so what it does isn't the routine work of other bots.
 *
 * @param {{ login?: string, type?: string } | null} [account]
 */
function isBotAccount(account) {
  return account?.type === 'Bot' && account.login !== COPILOT;
}

/**
 * @param {any} error
 */
function isForbidden(error) {
  return error.status === 403 && getRateLimitRetryTime(error) === null;
}

/**
 * @template {string} Key
 * @template Value
 * @param {(key: Key) => Promise<Value>} load
 * @returns {(key: Key) => Promise<Value>}
 */
function memoize(load) {
  /** @type {Map<Key, Promise<Value>>} */
  const cache = new Map();
  return (key) => {
    const cached = cache.get(key) ?? load(key);
    cache.set(key, cached);
    return cached;
  };
}

/**
 * @param {Object} options
 * @param {Octokit} options.octokit
 * @param {GitHubRepository} options.repository
 * @param {AbortSignal} options.signal
 */
function createAuthorResolver({ octokit, repository, signal }) {
  let hasWarnedAboutMembership = false;
  /**
   * @param {string} login
   */
  function creditUnchecked(login) {
    if (!hasWarnedAboutMembership) {
      hasWarnedAboutMembership = true;
      console.warn(
        `The token can't read the private members of ${repository.owner}. ` +
          `Authors that can't be checked, such as ${login}, are credited as community.`,
      );
    }
    return /** @type {const} */ ('community');
  }

  const getMembership = memoize(
    /**
     * @param {string} login
     * @returns {Promise<ChangelogAuthor['association']>}
     */
    async (login) => {
      try {
        await octokit.orgs.checkMembershipForUser({
          org: repository.owner,
          username: login,
          request: { signal },
        });
        return 'team';
      } catch (/** @type {any} */ error) {
        if (isForbidden(error)) {
          return creditUnchecked(login);
        }
        if (error.status === 404) {
          // GitHub redirects outsiders to the public members, which don't tell about private ones.
          return error.response?.url.includes('/public_members/')
            ? creditUnchecked(login)
            : 'community';
        }
        throw error;
      }
    },
  );

  const getOriginal = memoize(async (/** @type {string} */ key) => {
    const [owner, repo, number] = key.split('/');
    try {
      const { data } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: Number(number),
        request: { signal },
      });
      return /** @type {PullRequest} */ (data);
    } catch (/** @type {any} */ error) {
      if (error.status === 404 || isForbidden(error)) {
        return null;
      }
      throw error;
    }
  });

  /**
   * @param {PullRequest} pull
   * @param {GitHubRepository} pullRepository
   * @returns {Promise<ChangelogAuthor | null>}
   */
  async function getOpener(pull, pullRepository) {
    if (!pull.user) {
      return null;
    }
    const { login, type } = pull.user;
    const isSameRepository =
      pullRepository.owner === repository.owner && pullRepository.repo === repository.repo;
    /** @type {ChangelogAuthor['association']} */
    let association = 'community';
    if (type !== 'Bot') {
      association = isSameRepository
        ? (ASSOCIATIONS[pull.author_association] ?? 'community')
        : // The association with another repository says nothing about this one.
          await getMembership(login);
    }
    return { login, name: null, association, isBot: isBotAccount(pull.user) };
  }

  /**
   * The opener, or the person who asked Copilot for the pull request.
   *
   * @param {PullRequest} pull
   * @param {GitHubRepository} pullRepository
   * @returns {Promise<ChangelogAuthor | null>}
   */
  async function getCredit(pull, pullRepository) {
    if (pull.user?.login === COPILOT) {
      // It assigns itself and whoever asked for the pull request.
      const people = (pull.assignees ?? []).filter((assignee) => assignee.type !== 'Bot');
      if (people.length === 1) {
        const { login } = people[0];
        // The association of the pull request is the one of Copilot.
        return { login, name: null, association: await getMembership(login), isBot: false };
      }
    }
    return getOpener(pull, pullRepository);
  }

  /**
   * @param {PullRequest} pull
   * @param {GitHubRepository} pullRepository
   * @param {string[]} chain - Cherry-picks that led to this pull request
   * @returns {Promise<{ author: ChangelogAuthor | null, isBot: boolean, references: string[] } | null>}
   * `null` when the pull request is a cherry-pick by a bot of which the original author is unknown
   */
  async function resolve(pull, pullRepository, chain = []) {
    const isBot = isBotAccount(pull.user);
    const opener = async () => ({
      author: await getCredit(pull, pullRepository),
      isBot,
      references: [],
    });
    const references = getCherryPickReferences(pull, pullRepository);
    if (references.length === 0) {
      const isLabeled = pull.labels.some((label) => label.name === CHERRY_PICK_LABEL);
      return isBot && isLabeled ? null : opener();
    }

    const originals = await Promise.all(
      references.map(async (reference) => {
        const key = `${reference.owner}/${reference.repo}/${reference.number}`;
        const original = chain.includes(key) ? null : await getOriginal(key);
        return original && resolve(original, reference, [...chain, key]);
      }),
    );
    const author = originals[0]?.author;
    if (author && originals.every((original) => original?.author?.login === author.login)) {
      // A person who cherry-picks the work of a bot is the better credit.
      const isBotAuthor = originals.some((original) => original?.isBot);
      if (isBot || !isBotAuthor) {
        return {
          author,
          isBot: isBotAuthor,
          references: references.map((reference) => reference.text),
        };
      }
    }
    return isBot ? null : opener();
  }

  return {
    /**
     * @param {PullRequest} pull
     * @returns {Promise<{ author: ChangelogAuthor | null, openedBy: ChangelogAuthor | null, references: string[] }>}
     */
    async fromPullRequest(pull) {
      const openedBy = await getOpener(pull, repository);
      const resolved = await resolve(pull, repository);
      if (!resolved) {
        console.warn(
          `#${pull.number} is a cherry-pick, but its original author can't be determined. ` +
            `${openedBy?.login} is credited instead.`,
        );
        return { author: openedBy, openedBy, references: [] };
      }
      const { author, references } = resolved;
      if (author?.login === COPILOT) {
        console.warn(
          `#${pull.number} is by ${COPILOT}, but who it worked for can't be determined. ` +
            `${COPILOT} is credited instead.`,
        );
      }
      return { author, openedBy, references };
    },
    /**
     * @param {Commit} commit
     * @returns {Promise<ChangelogAuthor>}
     */
    async fromCommit(commit) {
      const login = commit.author?.login ?? null;
      return {
        login,
        name: commit.commit.author?.name ?? null,
        association:
          login === null || commit.author?.type === 'Bot'
            ? 'community'
            : await getMembership(login),
        isBot: isBotAccount(commit.author),
      };
    },
  };
}

/**
 * Strips trailing `(#1)` references, and `(@login)` credits when asked to.
 *
 * @param {string} title
 * @param {string[]} references
 * @param {boolean} stripCredits
 * @returns {string}
 */
function stripTrailingReferences(title, references, stripCredits) {
  const [, rest, reference] = /^(.*?)\s*\(([^()]+)\)$/.exec(title) ?? [];
  // The credit can name a login that has since been renamed.
  return references.includes(reference) || (stripCredits && /^@[\w-]+$/.test(reference))
    ? stripTrailingReferences(rest, references, stripCredits)
    : title;
}

/**
 * @param {Object} options
 * @param {Octokit} options.octokit
 * @param {GitHubRepository} options.repository
 * @param {string} options.previousSha
 * @param {string} options.releaseSha
 * @param {boolean} options.includeDirectCommits
 * @param {string[]} options.excludeBots - Logins whose changes are left out
 * @param {AbortController} options.controller - Aborted when a request fails
 * @returns {Promise<ChangelogChange[]>}
 */
export async function fetchChangelogChanges({
  octokit,
  repository,
  previousSha,
  releaseSha,
  includeDirectCommits,
  excludeBots,
  controller,
}) {
  const { signal } = controller;
  const excluded = new Set(excludeBots);
  const isExcluded = (/** @type {{ login?: string | null } | null | undefined} */ account) =>
    account?.login != null && excluded.has(account.login);
  const location = { ...repository, request: { signal } };
  const authors = createAuthorResolver({ octokit, repository, signal });

  async function listCommits() {
    /** @type {Commit[]} */
    const commits = [];
    let total = 0;
    const pages = octokit.paginate.iterator(
      octokit.repos.compareCommitsWithBasehead.endpoint.merge({
        ...location,
        basehead: `${previousSha}...${releaseSha}`,
        per_page: 100,
      }),
    );
    for await (const { data } of /** @type {AsyncIterable<any>} */ (pages)) {
      commits.push(...data.commits);
      total = data.total_commits;
    }
    if (commits.length !== total) {
      throw new Error(`GitHub listed ${commits.length} of the ${total} commits in the release.`);
    }
    return commits;
  }

  /**
   * Asks GitHub rather than trusting the message, where a reference to an issue or to another pull
   * request looks the same as the pull request the commit was merged from.
   *
   * @param {string} sha
   * @param {string} subject
   */
  async function findPullRequest(sha, subject) {
    const isMergedAsCommit = (
      /** @type {{ merged_at: string | null, merge_commit_sha: string | null }} */ pull,
    ) => pull.merged_at !== null && pull.merge_commit_sha === sha;

    const pulls = await octokit.paginate(octokit.repos.listPullRequestsAssociatedWithCommit, {
      ...location,
      commit_sha: sha,
      per_page: 100,
    });
    // On maintenance branches, GitHub also lists pull requests that merely contain the commit.
    const listed = pulls.find(isMergedAsCommit);
    if (listed) {
      return listed;
    }

    // GitHub lists nothing for some commits, such as mui/mui-x@227a2fee.
    const reference = /\(#(\d+)\)$/.exec(subject);
    if (!reference) {
      return null;
    }
    try {
      const { data } = await octokit.pulls.get({ ...location, pull_number: Number(reference[1]) });
      return isMergedAsCommit(data) ? data : null;
    } catch (/** @type {any} */ error) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * @param {Commit} commit
   * @returns {Promise<ChangelogChange | null>}
   */
  async function toChange(commit) {
    const { sha } = commit;
    const { message } = commit.commit;
    const subject = message.split('\n', 1)[0].trim();

    const pull = await findPullRequest(sha, subject);
    if (pull) {
      if (isExcluded(pull.user)) {
        return null;
      }
      const { author, openedBy, references } = await authors.fromPullRequest(pull);
      if (isExcluded(author)) {
        return null;
      }
      const ownReference = `#${pull.number}`;
      const title = subject.endsWith(`(${ownReference})`) ? subject : pull.title;
      const isCreditedCherryPick = references.length > 0;
      return {
        title: stripTrailingReferences(title, [ownReference, ...references], isCreditedCherryPick),
        message,
        sha,
        url: pull.html_url,
        labels: pull.labels.map((label) => label.name),
        isBreakingChange: pull.labels.some((label) => BREAKING_CHANGE_LABELS.includes(label.name)),
        pullRequest: {
          number: pull.number,
          title: pull.title,
          body: pull.body ?? '',
          openedBy,
        },
        author,
        createdAt: pull.created_at,
        mergedAt: pull.merged_at,
      };
    }

    if (!includeDirectCommits || isExcluded(commit.author)) {
      return null;
    }
    return {
      title: subject,
      message,
      sha,
      url: commit.html_url,
      labels: [],
      isBreakingChange: false,
      pullRequest: null,
      author: await authors.fromCommit(commit),
      createdAt: commit.commit.author?.date ?? null,
      mergedAt: commit.commit.committer?.date ?? null,
    };
  }

  const changes = await mapAsync(
    await listCommits(),
    async (commit) => {
      signal.throwIfAborted();
      try {
        return await toChange(commit);
      } catch (error) {
        // Immediately, or the next queued commit still gets to make its request.
        controller.abort(error);
        throw error;
      }
    },
    { concurrency: 10 },
  );
  return changes.filter((change) => change !== null);
}
