/**
 * @typedef {object} GitHubActor
 * @property {string} id Immutable GraphQL node id.
 * @property {string} type Account type, e.g. `Bot` or `User`.
 */

/**
 * Compares actors by immutable node id and account type, so a rename or an
 * impersonating login can never match.
 * @param {{ id?: unknown, type?: unknown }} actor
 * @param {GitHubActor | null | undefined} trustedActor
 * @returns {boolean}
 */
export const isSameGitHubActor = (actor, trustedActor) =>
  typeof actor?.id === 'string' &&
  typeof actor?.type === 'string' &&
  actor.id === trustedActor?.id &&
  actor.type === trustedActor?.type;
