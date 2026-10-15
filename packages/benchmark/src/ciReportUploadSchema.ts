import { z } from 'zod/v4';

/**
 * Creates a CI report upload schema for a specific report type: the envelope every report type
 * shares (commit, repository, branch, pull request) around its `report`. Kept apart from
 * `ciReport.ts`, which runs git, so the browser-safe run report schema can build on it.
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
    /** When the commit was made, in milliseconds: orders it in its timeline. */
    commitTimestamp: z.number().optional(),
    report: reportSchema,
  });
}
