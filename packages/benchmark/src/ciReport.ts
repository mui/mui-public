import { z } from 'zod/v4';

/**
 * Creates a CI report upload schema for a specific report type.
 * Common fields (commitSha, repo, branch, prNumber) are shared across all report types.
 */
function ciReportUploadSchema(type: string, version: number, reportSchema: z.ZodType) {
  return z.object({
    version: z.literal(version),
    timestamp: z.number(),
    commitSha: z.string().regex(/^[0-9a-f]{40}$/, 'Must be a 40-character hex string'),
    repo: z.string().includes('/', 'Must be in owner/repo format'),
    reportType: z.literal(type),
    prNumber: z.number().int().positive().optional(),
    branch: z.string(),
    report: reportSchema,
  });
}

const renderStatsSchema = z.object({
  id: z.string(),
  phase: z.enum(['mount', 'update', 'nested-update']),
  startTime: z.number(),
  actualDuration: z.number(),
  stdDev: z.number(),
  rawMean: z.number(),
  rawStdDev: z.number(),
  outliers: z.number(),
});

const benchmarkReportEntrySchema = z.object({
  iterations: z.number(),
  totalDuration: z.number(),
  renders: z.array(renderStatsSchema),
});

const benchmarkReportSchema = z.record(z.string(), benchmarkReportEntrySchema);

export const benchmarkUploadSchema = ciReportUploadSchema('benchmark', 1, benchmarkReportSchema);
