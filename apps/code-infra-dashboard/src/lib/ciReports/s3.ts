import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const BUCKET = 'mui-org-ci';
const REGION = 'eu-central-1';

// One client for the process, so calls share its connections: an upload's report and timeline
// pointer go out back to back.
let client: S3Client | undefined;

function getS3Client(): S3Client {
  client ??= new S3Client({ region: REGION });
  return client;
}

/**
 * Sanitizes a string to be used as an S3 tag value.
 */
function sanitizeTagValue(str: string): string {
  const safe = str.replace(/[^a-zA-Z0-9 +\-=.:/@]+/g, '_');
  return safe.length > 256 ? safe.substring(0, 256) : safe;
}

interface ObjectTags {
  isBaseBranch: boolean;
  /** The branch a same-org build ran on; `null` for a fork or a ref that isn't a branch. */
  branch: string | null;
}

/**
 * The tags every CI object carries, which the bucket's retention can key on. `branch` is left out
 * when the build has none.
 */
function taggingOf({ isBaseBranch, branch }: ObjectTags): string {
  const tags = new URLSearchParams({ isBaseBranch: isBaseBranch ? 'yes' : 'no' });
  if (branch !== null) {
    tags.set('branch', sanitizeTagValue(branch));
  }
  return tags.toString();
}

/**
 * Uploads a report to S3 with object tags.
 */
export async function uploadReport({
  key,
  body,
  ...tags
}: ObjectTags & { key: string; body: string }) {
  const client = getS3Client();

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      Tagging: taggingOf(tags),
    }),
  );
}

/**
 * Writes an empty object, tagged like the report it stands for: its key is all it records.
 */
export async function writeMarker({ key, ...tags }: ObjectTags & { key: string }) {
  const client = getS3Client();

  await client.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: '', Tagging: taggingOf(tags) }),
  );
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
