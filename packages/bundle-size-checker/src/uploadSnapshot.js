import fs from 'node:fs';
import { S3Client, PutObjectCommand, PutObjectTaggingCommand } from '@aws-sdk/client-s3';
import { execa } from 'execa';
import { fromEnv } from '@aws-sdk/credential-providers';

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
 * Sanitizes a string to be used as an S3 tag value
 * See https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html#tag-restrictions
 * @param {string} str
 * @returns {string}
 */
function sanitizeS3TagString(str) {
  // Replace disallowed characters with underscore
  const safe = str.replace(/[^a-zA-Z0-9 +\-=.:/@]+/g, '_');
  // Truncate to max lengths (256 for value)
  const maxLen = 256;
  return safe.length > maxLen ? safe.substring(0, maxLen) : safe;
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
    commitSha: sha,
    repo: uploadConfig.repo,
    reportType: 'size-snapshot',
    branch,
    prNumber: prNumber ? Number(prNumber) : undefined,
    report: JSON.parse(fileContent.toString('utf-8')),
  };

  const url = new URL('/api/ci-reports/upload', apiUrl);
  // eslint-disable-next-line no-console
  console.log(`POST ${url} (repo=${uploadConfig.repo}, sha=${sha.slice(0, 8)}...)`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
 * Uploads the snapshot directly to S3 using AWS credentials.
 * @param {Buffer} fileContent - The file content to upload
 * @param {NormalizedUploadConfig} uploadConfig - The normalized upload configuration
 * @param {string} sha - The commit SHA
 * @returns {Promise<{key:string}>}
 */
async function uploadDirectToS3(fileContent, uploadConfig, sha) {
  const { branch, isPullRequest } = uploadConfig;

  // Create S3 client (uses AWS credentials from environment)
  const client = new S3Client({
    region: process.env.AWS_REGION_ARTIFACTS || process.env.AWS_REGION || 'eu-central-1',
    credentials: fromEnv(),
  });

  // S3 bucket and key
  const bucket = 'mui-org-ci';
  const key = `artifacts/${uploadConfig.repo}/${sha}/size-snapshot.json`;

  // Upload the file first
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileContent,
      ContentType: 'application/json',
    }),
  );

  // Then add tags to the uploaded object
  await client.send(
    new PutObjectTaggingCommand({
      Bucket: bucket,
      Key: key,
      Tagging: {
        TagSet: [
          { Key: 'isPullRequest', Value: isPullRequest ? 'yes' : 'no' },
          { Key: 'branch', Value: sanitizeS3TagString(branch) },
        ],
      },
    }),
  );

  return { key };
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

  const apiUrl = process.env.CI_REPORT_API_URL;

  if (apiUrl) {
    // eslint-disable-next-line no-console
    console.log(`Uploading via dashboard API at ${apiUrl}`);
    return uploadViaApi(apiUrl, fileContent, uploadConfig, sha);
  }

  // eslint-disable-next-line no-console
  console.log('Uploading directly to S3');
  return uploadDirectToS3(fileContent, uploadConfig, sha);
}
