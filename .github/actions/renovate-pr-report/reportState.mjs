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

// The REST API reports app authors with the `[bot]` suffix, which no user login can
// contain, so an exact match cannot be spoofed by a same-named user account.
export const selectTrustedComments = (pages, authorLogin) =>
  pages
    .flatMap((page) => (Array.isArray(page) ? page : []))
    .filter((comment) => comment.user?.login === authorLogin)
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
  const stateLine = stickyComment?.body
    .split('\n')
    .find((line) => line.startsWith(STATE_PREFIX) && line.endsWith(STATE_SUFFIX));
  if (!stateLine) {
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
