import { benchmarkUploadSchema } from './ciReport';
import type { BenchmarkUpload } from './ciReport';

async function uploadCiReport(
  report: BenchmarkUpload,
  options?: { apiUrl?: string },
): Promise<void> {
  benchmarkUploadSchema.parse(report);

  const apiUrl =
    options?.apiUrl ?? process.env.CI_REPORT_API_URL ?? 'https://code-infra-dashboard.onrender.com';

  const url = new URL('/api/ci-reports/upload', apiUrl);

  // eslint-disable-next-line no-console
  console.log(`Uploading benchmark to ${url.href}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed (${response.status}): ${text}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Benchmark results uploaded to ${url.href}`);
}

export { uploadCiReport };
