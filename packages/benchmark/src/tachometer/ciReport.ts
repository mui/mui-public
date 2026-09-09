/* eslint-disable no-console -- progress belongs in the CI log. */

import { z } from 'zod/v4';
import { ciReportUploadSchema } from '../ciReport';

/**
 * Uploading a tachometer report to the CI report store.
 *
 * The envelope, the CI metadata and the pull request sync are the package's own — this axis differs
 * from the Vitest one only in the shape of `report`. Consumers reach the shared halves through
 * {@link getCiMetadata} and {@link syncPrComment}, re-exported here so a runner has one import.
 */

export { getCiMetadata } from '../ciReport';
export { syncPrComment } from '../syncPrComment';

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
 * The upload envelope. Built from the same factory the Vitest axis uses, so both report types reach
 * the dashboard's upload route in the shape it expects.
 */
export const tachometerUploadSchema = ciReportUploadSchema(
  'tachometer',
  1,
  tachometerReportSchema,
).extend({
  report: tachometerReportSchema,
});

export type TachometerUpload = z.infer<typeof tachometerUploadSchema>;
export type TachometerReport = z.infer<typeof tachometerReportSchema>;

/**
 * Uploads a report to the CI report store.
 *
 * Validates before sending because the server stores `report` without inspecting it — a malformed
 * report would be accepted here and only fail much later, when the dashboard tried to render it.
 */
export async function uploadCiReport(upload: TachometerUpload): Promise<void> {
  tachometerUploadSchema.parse(upload);

  const oidcToken = process.env.CIRCLE_OIDC_TOKEN_V2;
  if (!oidcToken) {
    throw new Error('CIRCLE_OIDC_TOKEN_V2 environment variable is required for uploads');
  }

  const url = new URL('/api/ci-reports/upload', process.env.CI_REPORT_API_URL ?? DEFAULT_API_URL);
  console.log(`Uploading tachometer report to ${url.href}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oidcToken}` },
    body: JSON.stringify(upload),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`The tachometer upload failed (${response.status}): ${responseText}`);
  }

  const result = JSON.parse(responseText);
  console.log(`Tachometer report uploaded. S3 key: ${result.key}`);
}
