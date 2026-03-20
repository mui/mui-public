import { z } from 'zod/v4';

/**
 * Creates a CI report upload schema for a specific report type.
 * Common fields (commitSha, repo, branch, prNumber) are shared across all report types.
 * @param {string} type - The report type literal (e.g. 'size-snapshot')
 * @param {number} version - The schema version number
 * @param {z.ZodType} reportSchema - Zod schema for the report payload
 */
export function ciReportUploadSchema(type, version, reportSchema) {
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

const sizeSnapshotEntrySchema = z.object({
  parsed: z.number(),
  gzip: z.number(),
});

const sizeSnapshotSchema = z.record(z.string(), sizeSnapshotEntrySchema);

export const sizeSnapshotUploadSchema = ciReportUploadSchema(
  'size-snapshot',
  1,
  sizeSnapshotSchema,
);

/**
 * @typedef {z.infer<typeof sizeSnapshotUploadSchema>} SizeSnapshotUpload
 */
