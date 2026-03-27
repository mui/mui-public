import { execa } from 'execa';
import { z } from 'zod/v4';
import envCi from 'env-ci';

interface CiInfo {
  isCi: boolean;
  commit?: string;
  branch?: string;
  isPr?: boolean;
  pr?: string;
  prBranch?: string;
  slug?: string;
}

async function getCommitSha(): Promise<string | null> {
  try {
    const { stdout } = await execa('git', ['rev-parse', 'HEAD']);
    return stdout.trim();
  } catch {
    return null;
  }
}

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
  outliers: z.number(),
});

const metricStatsSchema = z.object({
  mean: z.number(),
  stdDev: z.number(),
  outliers: z.number(),
});

const benchmarkReportEntrySchema = z.object({
  iterations: z.number(),
  totalDuration: z.number(),
  renders: z.array(renderStatsSchema),
  metrics: z.record(z.string(), metricStatsSchema),
});

const benchmarkReportSchema = z.record(z.string(), benchmarkReportEntrySchema);

export const benchmarkUploadSchema = ciReportUploadSchema('benchmark', 1, benchmarkReportSchema);

export type RenderStats = z.infer<typeof renderStatsSchema>;
export type MetricStats = z.infer<typeof metricStatsSchema>;
export type BenchmarkReportEntry = z.infer<typeof benchmarkReportEntrySchema>;
export type BenchmarkReport = z.infer<typeof benchmarkReportSchema>;
export type BenchmarkUpload = z.infer<typeof benchmarkUploadSchema>;

export async function getCiMetadata() {
  const ciInfo: CiInfo = envCi();
  return {
    timestamp: Date.now(),
    repo: ciInfo.slug ?? '',
    branch: ciInfo.isPr ? (ciInfo.prBranch ?? '') : (ciInfo.branch ?? ''),
    prNumber: ciInfo.pr ? Number(ciInfo.pr) : undefined,
    commitSha: ciInfo.commit ?? (await getCommitSha()) ?? '',
  };
}
