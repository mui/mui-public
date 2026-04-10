export interface ReportOptions {
  repo: string;
  prNumber: number;
  commitSha: string;
  pr: { base: { sha: string; ref: string } };
  baseCandidates: string[];
}

export interface ReportResult {
  content: string;
}
