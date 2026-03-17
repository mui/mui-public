import { S3Client, PutObjectCommand, PutObjectTaggingCommand } from '@aws-sdk/client-s3';

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
  branch: string;
}

/**
 * Uploads a report to S3 and applies object tags.
 */
export async function uploadReport({ key, body, isPullRequest, branch }: UploadReportOptions) {
  const client = getS3Client();

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    }),
  );

  await client.send(
    new PutObjectTaggingCommand({
      Bucket: BUCKET,
      Key: key,
      Tagging: {
        TagSet: [
          { Key: 'isPullRequest', Value: isPullRequest ? 'yes' : 'no' },
          { Key: 'branch', Value: sanitizeTagValue(branch) },
        ],
      },
    }),
  );
}
