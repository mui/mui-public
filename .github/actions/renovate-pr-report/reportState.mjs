import { isSameGitHubActor } from './githubUtils.mjs';

/**
 * @typedef {object} Verdict An LLM release-notes verdict for one pull request.
 * @property {number} number The pull request number.
 * @property {'yes' | 'no' | 'unclear'} breaking
 * @property {boolean} security
 * @property {string} dependency
 * @property {string} reason
 */

/**
 * @typedef {object} CommentNode A comment node from the GraphQL query in action.yml.
 * @property {number} databaseId
 * @property {string} body
 * @property {{ login: string, type: string, id?: string } | null} author
 */

/**
 * @typedef {object} TrustedComment
 * @property {number} id The comment's REST id, for in-place updates.
 * @property {string} body
 */

/**
 * @typedef {object} ReportedSignature What a comment reported, minus the free-form
 * reason — the next run re-pings only when this changes.
 * @property {'yes' | 'no' | 'unclear'} breaking
 * @property {boolean} security
 * @property {string} dependency
 */

/**
 * @typedef {object} VerdictState The state a verdict comment carries in its last line.
 * @property {number} commentId
 * @property {string} sha Head SHA the verdict was produced for; empty when unknown.
 * @property {Verdict | null} verdict
 * @property {ReportedSignature | null} reported
 */

const STATE_PREFIX = '<!-- renovate-pr-report-state: ';
const STATE_SUFFIX = ' -->';
const BREAKING_VALUES = new Set(['yes', 'no', 'unclear']);

/**
 * Validates that an untrusted parsed value has the exact shape of an LLM verdict.
 * @param {*} value
 * @returns {value is Verdict}
 */
const isVerdict = (value) =>
  Number.isInteger(value?.number) &&
  BREAKING_VALUES.has(value.breaking) &&
  typeof value.security === 'boolean' &&
  typeof value.dependency === 'string' &&
  typeof value.reason === 'string';

/**
 * Validates that an untrusted parsed value has the exact shape of a reported signature.
 * @param {*} value
 * @returns {value is ReportedSignature}
 */
const isReportedSignature = (value) =>
  BREAKING_VALUES.has(value?.breaking) &&
  typeof value.security === 'boolean' &&
  typeof value.dependency === 'string';

/**
 * Keeps only the comments authored by the trusted actor, in a normalized shape.
 * @param {CommentNode[] | null | undefined} comments
 * @param {import('./githubUtils.mjs').GitHubActor} trustedActor
 * @returns {TrustedComment[]}
 */
export const selectTrustedComments = (comments, trustedActor) =>
  (comments ?? [])
    .filter((comment) =>
      isSameGitHubActor({ id: comment.author?.id, type: comment.author?.type }, trustedActor),
    )
    .map((comment) => ({ id: comment.databaseId, body: comment.body }));

/**
 * Serializes the state into the HTML comment that ends a verdict comment body.
 * @param {{ sha: string, verdict: Verdict | null, reported?: ReportedSignature }} state
 * @returns {string}
 */
export const serializeVerdictState = (state) =>
  `${STATE_PREFIX}${JSON.stringify(state)}${STATE_SUFFIX}`;

/**
 * Finds the last trusted verdict comment and returns its embedded state. The state is
 * read from the final line only, so marker-shaped text earlier in the body (e.g. echoed
 * from release notes) cannot forge it.
 * @param {TrustedComment[]} comments
 * @param {string} verdictMarker
 * @returns {VerdictState | null} Null when no trusted verdict comment exists.
 */
export const parseVerdictState = (comments, verdictMarker) => {
  const sticky = comments.findLast(
    (comment) => typeof comment.body === 'string' && comment.body.startsWith(verdictMarker),
  );
  if (!sticky) {
    return null;
  }
  const empty = { commentId: sticky.id, sha: '', verdict: null, reported: null };

  const stateLine = sticky.body.trimEnd().split('\n').at(-1);
  const hasStateMarker = stateLine?.startsWith(STATE_PREFIX) && stateLine.endsWith(STATE_SUFFIX);
  if (!hasStateMarker) {
    return empty;
  }

  try {
    const state = JSON.parse(stateLine.slice(STATE_PREFIX.length, -STATE_SUFFIX.length));
    return {
      commentId: sticky.id,
      sha: typeof state?.sha === 'string' ? state.sha : '',
      verdict: isVerdict(state?.verdict) ? state.verdict : null,
      reported: isReportedSignature(state?.reported) ? state.reported : null,
    };
  } catch {
    return empty;
  }
};
