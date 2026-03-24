import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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
  isPullRequest: boolean;
  retained: boolean;
  branch: string;
}

/**
 * Uploads a report to S3 with object tags.
 */
export async function uploadReport({
  key,
  body,
  isPullRequest,
  retained,
  branch,
}: UploadReportOptions) {
  const client = getS3Client();

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      Tagging: new URLSearchParams({
        isPullRequest: isPullRequest ? 'yes' : 'no',
        retained: retained ? 'yes' : 'no',
        branch: sanitizeTagValue(branch),
      }).toString(),
    }),
  );
}
