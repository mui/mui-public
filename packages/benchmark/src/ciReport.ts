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

interface GitInfo {
  commitSha: string;
  branch: string;
}

async function getGitInfo(): Promise<GitInfo> {
  const [commit, branch] = await Promise.all([
    execa('git', ['rev-parse', 'HEAD']),
    execa('git', ['branch', '--show-current']),
  ]);
  return { commitSha: commit.stdout, branch: branch.stdout };
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

const benchmarkBaseUploadSchema = ciReportUploadSchema('benchmark', 1, benchmarkReportSchema);

export const benchmarkUploadSchema = benchmarkBaseUploadSchema.extend({
  base: benchmarkBaseUploadSchema.optional(),
});

export type RenderStats = z.infer<typeof renderStatsSchema>;
export type MetricStats = z.infer<typeof metricStatsSchema>;
export type BenchmarkReportEntry = z.infer<typeof benchmarkReportEntrySchema>;
export type BenchmarkReport = z.infer<typeof benchmarkReportSchema>;
export type BenchmarkBaseUpload = z.infer<typeof benchmarkBaseUploadSchema>;
export type BenchmarkUpload = z.infer<typeof benchmarkUploadSchema>;

export async function getCiMetadata() {
  const ciInfo: CiInfo = envCi();
  const gitInfo = await getGitInfo();
  return {
    timestamp: Date.now(),
    repo: ciInfo.slug ?? '',
    prNumber: ciInfo.pr ? Number(ciInfo.pr) : undefined,
    branch:
      gitInfo.branch ||
      process.env.BENCHMARK_BRANCH ||
      (ciInfo.isPr ? ciInfo.prBranch : ciInfo.branch) ||
      '',
    commitSha: gitInfo.commitSha,
  };
}
