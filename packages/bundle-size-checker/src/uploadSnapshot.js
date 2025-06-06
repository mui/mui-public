import fs from 'fs';
import { S3Client, PutObjectCommand, PutObjectTaggingCommand } from '@aws-sdk/client-s3';
import { execa } from 'execa';
import { fromEnv } from '@aws-sdk/credential-providers';

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
  const safe = str.replace(/[^a-zA-Z0-9 +-=.:/@]+/g, '_');
  // Truncate to max lengths (256 for value)
  const maxLen = 256;
  return safe.length > maxLen ? safe.substring(0, maxLen) : safe;
}

/**
 * Uploads the size snapshot to S3
 * @param {string} snapshotPath - The path to the size snapshot JSON file
 * @param {NormalizedUploadConfig} uploadConfig - The normalized upload configuration
 * @param {string} [commitSha] - Optional commit SHA (defaults to current Git HEAD)
 * @returns {Promise<{key:string}>}
 */
export async function uploadSnapshot(snapshotPath, uploadConfig, commitSha) {
  // By the time this function is called, the config should be fully normalized
  // No need to check for repo existence as it's required in the normalized config

  // Run git operations and file reading in parallel
  const [sha, fileContent] = await Promise.all([
    // Get the current commit SHA if not provided
    commitSha || getCurrentCommitSHA(),
    // Read the snapshot file
    fs.promises.readFile(snapshotPath),
  ]);

  // Use values from normalized config
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
