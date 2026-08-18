import { isSameGitHubActor } from './githubUtils.mjs';

const STATE_PREFIX = '<!-- renovate-pr-report-state: ';
const STATE_SUFFIX = ' -->';
const BREAKING_VALUES = new Set(['yes', 'no', 'unclear']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const isVerdict = (value) =>
  isRecord(value) &&
  Number.isInteger(value.number) &&
  BREAKING_VALUES.has(value.breaking) &&
  typeof value.security === 'boolean' &&
  typeof value.dependency === 'string' &&
  typeof value.reason === 'string';

export const selectTrustedComments = (pages, trustedActor) =>
  pages
    .flatMap((page) => (Array.isArray(page) ? page : []))
    .filter((comment) =>
      isSameGitHubActor({ id: comment.user?.node_id, type: comment.user?.type }, trustedActor),
    )
    .map((comment) => ({
      id: comment.id,
      body: comment.body,
      createdAt: comment.created_at,
    }));

export const serializeReportState = (state) =>
  `${STATE_PREFIX}${JSON.stringify(state)}${STATE_SUFFIX}`;

export const parseReportState = (comments, stickyMarker) => {
  const stickyComment = comments.findLast(
    (comment) => typeof comment.body === 'string' && comment.body.startsWith(stickyMarker),
  );
  const stateLine = stickyComment?.body.trimEnd().split('\n').at(-1);
  const hasStateMarker = stateLine?.startsWith(STATE_PREFIX) && stateLine.endsWith(STATE_SUFFIX);
  if (!hasStateMarker) {
    return { cache: {}, announced: [] };
  }

  try {
    const state = JSON.parse(stateLine.slice(STATE_PREFIX.length, -STATE_SUFFIX.length));
    if (!isRecord(state)) {
      return { cache: {}, announced: [] };
    }

    const cache = isRecord(state.cache)
      ? Object.fromEntries(Object.entries(state.cache).filter(([, verdict]) => isVerdict(verdict)))
      : {};
    const announced = Array.isArray(state.announced)
      ? state.announced.filter((key) => typeof key === 'string')
      : [];
    return { cache, announced };
  } catch {
    return { cache: {}, announced: [] };
  }
};
