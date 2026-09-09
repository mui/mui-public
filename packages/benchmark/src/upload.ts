/* eslint-disable no-console -- progress belongs in the CI log. */

import { postToDashboard } from './ciApi';
import { benchmarkUploadSchema } from './ciReport';
import type { BenchmarkUpload } from './ciReport';

/**
 * Uploads a benchmark report to the CI report store.
 *
 * Validated before sending: the server stores `report` without inspecting it, so a malformed one
 * would be accepted here and only fail later, when the dashboard tried to render it.
 */
async function uploadCiReport(report: BenchmarkUpload): Promise<void> {
  benchmarkUploadSchema.parse(report);

  const responseText = await postToDashboard(
    '/api/ci-reports/upload',
    report,
    'The benchmark upload',
  );
  const result = JSON.parse(responseText);
  console.log(`Benchmark results uploaded successfully. S3 key: ${result.key}`);
}

export { uploadCiReport };
