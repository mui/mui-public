import type { KpiResult } from '../types';
import { checkHttpError, errorResult, successResult } from './utils';

export async function fetchCompletionTime(repository: string): Promise<KpiResult> {
  const response = await fetch(
    `https://circleci.com/api/v2/insights/github/mui/${repository}/workflows/pipeline/summary?analytics-segmentation=web-ui-insights&reporting-window=last-7-days&workflow-name=pipeline`,
    { next: { revalidate: 3600 } },
  );

  const httpError = checkHttpError(response);
  if (httpError) {
    return httpError;
  }

  const data = await response.json();

  if (!data.metrics?.duration_metrics?.median) {
    return errorResult('No duration metrics available');
  }

  const medianMinutes = Math.round((data.metrics.duration_metrics.median / 60) * 100) / 100;

  return successResult(medianMinutes, `Based on the last 7 days (${data.metrics.total_runs} runs)`);
}
