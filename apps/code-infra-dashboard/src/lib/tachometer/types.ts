/**
 * Types mirroring @mui/internal-code-infra/tachometerReport.
 *
 * Mirrored rather than imported on purpose: these describe artifacts already sitting in S3, written
 * by whatever version of the tooling a repository had at the time. Importing the current definitions
 * would make the dashboard assume every stored report matches today's shape.
 */

export interface ConfidenceInterval {
  low: number;
  high: number;
}

export type Verdict = 'faster' | 'slower' | 'unsure';

export interface TachometerVariantResult {
  variant: string;
  refId: string | null;
  meanMs: ConfidenceInterval;
  samples: number;
  bytesSent: number;
}

export interface TachometerComparison {
  variant: string;
  verdict: Verdict;
  /** The reference relative to `variant`: positive means the reference is slower. */
  absoluteMs: ConfidenceInterval;
  percentChange: ConfidenceInterval;
  /** The same pair the other way round. Each direction has its own denominator. */
  versusReference?: {
    verdict: Verdict;
    absoluteMs: ConfidenceInterval;
    percentChange: ConfidenceInterval;
  };
}

export interface TachometerMeasurementResult {
  name: string;
  variants: TachometerVariantResult[];
  comparisons: TachometerComparison[];
}

export interface TachometerCaseResult {
  name: string;
  /** The variant every comparison is expressed against. Absent when the case failed to summarize. */
  reference?: string;
  measurements?: TachometerMeasurementResult[];
  error?: string;
}

export interface TachometerReport {
  version: number;
  reportType: 'tachometer';
  generatedAt: string;
  head: { ref: string; sha: string; branch?: string };
  browser?: string;
  refs: Array<{ id: string; kind: string; label: string; sha?: string }>;
  cases: TachometerCaseResult[];
  raw?: Record<string, unknown>;
}

/** The stored upload envelope, as the upload route writes it. */
export interface TachometerUpload {
  version: number;
  timestamp: number;
  commitSha: string;
  repo: string;
  reportType: 'tachometer';
  prNumber?: number;
  branch: string;
  report: TachometerReport;
}
