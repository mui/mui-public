/* eslint-disable no-console -- progress belongs in the CI log. */

import { z } from 'zod/v4';
import { postToDashboard } from '../ciApi';
import { ciReportUploadSchema } from '../ciReport';

/**
 * The tachometer axis's upload envelope. It differs from the Vitest one only in the shape of
 * `report`; the transport, the CI metadata and the pull request sync are shared.
 */

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
export const tachometerUploadSchema = ciReportUploadSchema('tachometer', 1, tachometerReportSchema);

export type TachometerUpload = z.infer<typeof tachometerUploadSchema>;
export type TachometerReport = z.infer<typeof tachometerReportSchema>;
export type CaseResult = z.infer<typeof caseResultSchema>;
export type MeasurementResult = z.infer<typeof measurementResultSchema>;
export type VariantResult = z.infer<typeof variantResultSchema>;
export type Comparison = z.infer<typeof comparisonSchema>;

/**
 * Uploads a report to the CI report store.
 *
 * Validates before sending because the server stores `report` without inspecting it — a malformed
 * report would be accepted here and only fail much later, when the dashboard tried to render it.
 */
export async function uploadCiReport(upload: TachometerUpload): Promise<void> {
  tachometerUploadSchema.parse(upload);

  const responseText = await postToDashboard(
    '/api/ci-reports/upload',
    upload,
    'The tachometer upload',
  );
  const result = JSON.parse(responseText);
  console.log(`Tachometer report uploaded. S3 key: ${result.key}`);
}
