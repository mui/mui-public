/**
 * Extracts the job id from a GitHub Actions check-run details URL, or null when the
 * URL points elsewhere.
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export const parseGitHubJob = (url) =>
  /\/actions\/runs\/\d+\/job\/(\d+)/.exec(url ?? '')?.[1] ?? null;

/**
 * Extracts the job number from a CircleCI commit-status target URL, or null when the
 * URL points elsewhere.
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export const parseCircleCiJob = (url) =>
  /^https:\/\/circleci\.com\/gh\/[^/]+\/[^/]+\/(\d+)/.exec(url ?? '')?.[1] ?? null;

/**
 * Keeps the end of a log — the part with the failure — bounded by lines and characters.
 * @param {string} text
 * @param {number} maxLines
 * @param {number} maxChars
 * @returns {string}
 */
export const tailText = (text, maxLines, maxChars) => {
  const tail = text.split('\n').slice(-maxLines).join('\n');
  return tail.length > maxChars ? tail.slice(-maxChars) : tail;
};
