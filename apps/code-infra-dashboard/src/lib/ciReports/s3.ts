import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const BUCKET = 'mui-org-ci';
const REGION = 'eu-central-1';

function getS3Client(): S3Client {
  return new S3Client({ region: REGION });
}

/**
 * Sanitizes a string to be used as an S3 tag value.
 */
function sanitizeTagValue(str: string): string {
  const safe = str.replace(/[^a-zA-Z0-9 +\-=.:/@]+/g, '_');
  return safe.length > 256 ? safe.substring(0, 256) : safe;
}

interface UploadReportOptions {
  key: string;
  body: string;
  isBaseBranch: boolean;
  branch: string;
}

/**
 * Uploads a report to S3 with object tags.
 */
export async function uploadReport({ key, body, isBaseBranch, branch }: UploadReportOptions) {
  const client = getS3Client();

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      Tagging: new URLSearchParams({
        isBaseBranch: isBaseBranch ? 'yes' : 'no',
        branch: sanitizeTagValue(branch),
      }).toString(),
    }),
  );
}

/**
 * Writes an empty object: its key is all it records.
 */
export async function writeMarker(key: string) {
  const client = getS3Client();

  await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: '' }));
}

/**
 * Lists up to `limit` keys under `prefix` in ascending order, continuing from `cursor`, a previous
 * listing's `next`.
 */
export async function listKeys(
  prefix: string,
  limit: number,
  cursor?: string,
): Promise<{ keys: string[]; next: string | undefined }> {
  const client = getS3Client();

  const result = await client.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      MaxKeys: limit,
      ContinuationToken: cursor,
    }),
  );
  return {
    keys: (result.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : [])),
    next: result.NextContinuationToken,
  };
}
