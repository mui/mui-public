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

  const oidcToken = process.env.CIRCLE_OIDC_TOKEN_V2;
  if (!oidcToken) {
    throw new Error('CIRCLE_OIDC_TOKEN_V2 environment variable is required for uploads');
  }

  // eslint-disable-next-line no-console
  console.log('Upload request body:', JSON.stringify({ ...report, report: '...' }, null, 2));
  // eslint-disable-next-line no-console
  console.log(`Uploading benchmark to ${url.href}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oidcToken}` },
    body: JSON.stringify(report),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Upload failed (${response.status}): ${responseText}`);
  }

  const result = JSON.parse(responseText);
  // eslint-disable-next-line no-console
  console.log(`Benchmark results uploaded successfully. S3 key: ${result.key}`);
}

export { uploadCiReport };
