import { z } from 'zod/v4';

/**
 * Creates a CI report upload schema for a specific report type: the envelope every report type
 * shares (commit, repository, branch, pull request) around its `report`. Browser-safe, so the
 * dashboard can read with the same schemas the uploaders validate with.
 */
export function ciReportUploadSchema<ReportSchema extends z.ZodType>(
  type: string,
  version: number,
  reportSchema: ReportSchema,
) {
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
