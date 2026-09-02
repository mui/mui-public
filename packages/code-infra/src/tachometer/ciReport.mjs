/* eslint-disable no-console -- progress belongs in the CI log. */

import { execa } from 'execa';
import envCi from 'env-ci';
import { z } from 'zod/v4';

/**
 * Uploading a tachometer report to the CI report store, and asking the dashboard to refresh the
 * pull request comment.
 *
 * The transport is deliberately a small copy of `@mui/internal-benchmark`'s rather than a shared
 * import: code-infra carries a large dependency tree, and having the benchmark package depend on it
 * would push all of that onto every consumer. What is duplicated — a bearer-token POST to one
 * endpoint — is small and does not move.
 */

const DEFAULT_API_URL = 'https://frontend-public.mui.com';

const confidenceIntervalSchema = z.object({
  low: z.number(),
  high: z.number(),
});

const differenceSchema = z.object({
  verdict: z.enum(['faster', 'slower', 'unsure']),
  absoluteMs: confidenceIntervalSchema,
  percentChange: confidenceIntervalSchema,
});

const variantResultSchema = z.object({
  variant: z.string(),
  refId: z.string().nullable(),
  meanMs: confidenceIntervalSchema,
  samples: z.number(),
  bytesSent: z.number(),
});

const comparisonSchema = differenceSchema.extend({
  variant: z.string(),
  versusReference: differenceSchema.optional(),
});

const measurementResultSchema = z.object({
  name: z.string(),
  variants: z.array(variantResultSchema),
  comparisons: z.array(comparisonSchema),
});

// A case that failed to summarize carries an `error` and no measurements. It is kept in the report
// rather than dropped, so the comment can say a case produced nothing instead of quietly omitting it.
const caseResultSchema = z.object({
  name: z.string(),
  reference: z.string().optional(),
  measurements: z.array(measurementResultSchema).optional(),
  error: z.string().optional(),
});

const tachometerReportSchema = z.object({
  version: z.number(),
  reportType: z.literal('tachometer'),
  generatedAt: z.string(),
  head: z.object({ ref: z.string(), sha: z.string(), branch: z.string().optional() }),
  browser: z.string().optional(),
  refs: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      label: z.string(),
      sha: z.string().optional(),
    }),
  ),
  cases: z.array(caseResultSchema),
  // Every sample tachometer produced. Not read by the comment, but kept so a richer view can be
  // built later without changing what CI uploads.
  raw: z.record(z.string(), z.unknown()),
});

/**
 * The upload envelope, matching what `@mui/internal-benchmark` sends and what the dashboard's
 * upload route expects.
 */
export const tachometerUploadSchema = z.object({
  version: z.literal(1),
  timestamp: z.number(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/, 'Must be a 40-character hex string'),
  repo: z.string().includes('/', 'Must be in owner/repo format'),
  reportType: z.literal('tachometer'),
  prNumber: z.number().int().positive().optional(),
  branch: z.string(),
  report: tachometerReportSchema,
});

/**
 * @typedef {z.infer<typeof tachometerUploadSchema>} TachometerUpload
 */

/**
 * Resolves the commit, branch, repository and pull request this run belongs to.
 *
 * The commit and branch come from git rather than the CI provider: a provider reports the branch it
 * was triggered for, which on a pull request build is not necessarily the checkout's own.
 *
 * @returns {Promise<{ timestamp: number, repo: string, prNumber: number | undefined, branch: string, commitSha: string }>}
 */
export async function getCiMetadata() {
  const ciInfo = /** @type {any} */ (envCi());
  const [commit, branch] = await Promise.all([
    execa('git', ['rev-parse', 'HEAD']),
    execa('git', ['branch', '--show-current']),
  ]);

  return {
    timestamp: Date.now(),
    repo: ciInfo.slug ?? '',
    prNumber: ciInfo.pr ? Number(ciInfo.pr) : undefined,
    branch: branch.stdout.trim() || (ciInfo.isPr ? ciInfo.prBranch : ciInfo.branch) || '',
    commitSha: commit.stdout.trim(),
  };
}

/**
 * Uploads a report to the CI report store.
 *
 * Validates before sending because the server stores `report` without inspecting it — a malformed
 * report would be accepted here and only fail much later, when the dashboard tried to render it.
 *
 * @param {TachometerUpload} upload - The envelope to send
 * @returns {Promise<void>}
 */
export async function uploadCiReport(upload) {
  tachometerUploadSchema.parse(upload);

  const apiUrl = process.env.CI_REPORT_API_URL ?? DEFAULT_API_URL;
  const url = new URL('/api/ci-reports/upload', apiUrl);

  const oidcToken = process.env.CIRCLE_OIDC_TOKEN_V2;
  if (!oidcToken) {
    throw new Error('CIRCLE_OIDC_TOKEN_V2 environment variable is required for uploads');
  }

  console.log(`Uploading tachometer report to ${url.href}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oidcToken}` },
    body: JSON.stringify(upload),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Upload failed (${response.status}): ${responseText}`);
  }

  const result = JSON.parse(responseText);
  console.log(`Tachometer report uploaded. S3 key: ${result.key}`);
}

/**
 * Asks the dashboard to regenerate the pull request comment for `repo`.
 *
 * @param {string} repo - The repository, as `owner/name`
 * @returns {Promise<{ success: boolean, skipped?: boolean }>}
 */
export async function syncPrComment(repo) {
  const oidcToken = process.env.CIRCLE_OIDC_TOKEN_V2;
  if (!oidcToken) {
    throw new Error('CIRCLE_OIDC_TOKEN_V2 environment variable is required for PR comment sync');
  }

  const apiUrl = process.env.CI_REPORT_API_URL ?? DEFAULT_API_URL;
  const url = new URL('/api/ci-reports/sync-pr-comment', apiUrl);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oidcToken}` },
    body: JSON.stringify({ repo }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Sync PR comment API returned ${response.status} ${response.statusText}: ${responseText}`,
    );
  }

  return response.json();
}
