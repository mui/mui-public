import fs from 'node:fs';
import { execa } from 'execa';

/**
 * @typedef {import('./types.js').NormalizedUploadConfig} NormalizedUploadConfig
 */

/**
 * Gets the current Git commit SHA
 * @returns {Promise<string>} The current commit SHA
 */
async function getCurrentCommitSHA() {
  const { stdout } = await execa('git', ['rev-parse', 'HEAD']);
  return stdout.trim();
}

/**
 * Uploads the snapshot via the dashboard API (server-side proxied to S3).
 * @param {string} apiUrl - Base URL of the CI report API
 * @param {Buffer} fileContent - The file content to upload
 * @param {NormalizedUploadConfig} uploadConfig - The normalized upload configuration
 * @param {string} sha - The commit SHA
 * @returns {Promise<{key:string}>}
 */
async function uploadViaApi(apiUrl, fileContent, uploadConfig, sha) {
  const { branch, prNumber } = uploadConfig;

  /** @type {import('./ciReport.js').SizeSnapshotUpload} */
  const requestBody = {
    version: 1,
    timestamp: Date.now(),
    commitSha: sha,
    repo: uploadConfig.repo,
    reportType: 'size-snapshot',
    branch,
    prNumber: prNumber ? Number(prNumber) : undefined,
    report: JSON.parse(fileContent.toString('utf-8')),
  };

  // eslint-disable-next-line no-console
  console.log('Upload request body:', JSON.stringify({ ...requestBody, report: '...' }, null, 2));

  const url = new URL('/api/ci-reports/upload', apiUrl);

  const oidcToken = process.env.CIRCLE_OIDC_TOKEN_V2;
  if (!oidcToken) {
    throw new Error('CIRCLE_OIDC_TOKEN_V2 environment variable is required for uploads');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oidcToken}` },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Upload API returned ${response.status} ${response.statusText}: ${responseText}`,
    );
  }

  const result = JSON.parse(responseText);
  return { key: result.key };
}

/**
 * Uploads the size snapshot to S3
 * @param {string} snapshotPath - The path to the size snapshot JSON file
 * @param {NormalizedUploadConfig} uploadConfig - The normalized upload configuration
 * @param {string} [commitSha] - Optional commit SHA (defaults to current Git HEAD)
 * @returns {Promise<{key:string}>}
 */
export async function uploadSnapshot(snapshotPath, uploadConfig, commitSha) {
  // Run git operations and file reading in parallel
  const [sha, fileContent] = await Promise.all([
    commitSha || getCurrentCommitSHA(),
    fs.promises.readFile(snapshotPath),
  ]);

  return uploadViaApi(uploadConfig.apiUrl, fileContent, uploadConfig, sha);
}
