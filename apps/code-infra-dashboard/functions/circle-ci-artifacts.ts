import type { Handler } from '@netlify/functions';
import zlib from 'node:zlib';
import util from 'node:util';
import computeEtag from 'etag';

const gzip = util.promisify(zlib.gzip);

interface CircleCIArtifact {
  path: string;
  url: string;
  node_index: number;
}

interface CircleCIArtifactsResponse {
  items: CircleCIArtifact[];
}

const enableCacheControl = true;

/**
 * netlify function that wraps CircleCI API v2 which requires CORS.
 */
export const handler: Handler = async function circleCIArtifact(event, context) {
  const { queryStringParameters } = event;

  const buildNumberParameter = queryStringParameters?.buildNumber;
  const buildNumber =
    typeof buildNumberParameter === 'string' ? parseInt(buildNumberParameter, 10) : NaN;
  if (Number.isNaN(buildNumber)) {
    return {
      statusCode: 400,
      body: JSON.stringify(
        `Given query param buildNumber is not a number. Received '${buildNumberParameter}'.`,
      ),
    };
  }

  const org = queryStringParameters?.org;
  if (!org) {
    return {
      statusCode: 400,
      body: JSON.stringify('Missing required query parameter: org'),
    };
  }

  const repository = queryStringParameters?.repository;
  if (!repository) {
    return {
      statusCode: 400,
      body: JSON.stringify('Missing required query parameter: repository'),
    };
  }

  const artifactsUrl = `https://circleci.com/api/v2/project/github/${org}/${repository}/${buildNumber}/artifacts`;
  const artifactsResponse = await fetch(artifactsUrl);

  if (!artifactsResponse.ok) {
    return {
      statusCode: artifactsResponse.status,
      body: JSON.stringify(
        `CircleCI API returned ${artifactsResponse.status} ${artifactsResponse.statusText}`,
      ),
    };
  }

  const artifactsJson = (await artifactsResponse.json()) as CircleCIArtifactsResponse;
  const sizeSnapshotArtifact = artifactsJson.items.find(
    (artifact) => artifact.path === 'size-snapshot.json',
  );

  if (!sizeSnapshotArtifact) {
    return {
      statusCode: 404,
      body: JSON.stringify(`No size-snapshot.json artifact found for build #${buildNumber}`),
    };
  }

  const sizeSnapshotUrl = sizeSnapshotArtifact.url;

  const ifNoneMatch = event.headers['if-none-match'];
  const etag = computeEtag(
    JSON.stringify({ url: sizeSnapshotUrl, version: context.functionVersion }),
  );

  if (ifNoneMatch === etag) {
    // No need to download every artifact again since they're immutable.
    const response = {
      statusCode: 304,
      headers: {
        ...(enableCacheControl ? { 'Cache-Control': 'immutable, max-age=86400' } : {}),
        ETag: etag,
      },
    };

    return response;
  }

  const sizeSnapshotResponse = await fetch(sizeSnapshotUrl);
  if (!sizeSnapshotResponse.ok) {
    return {
      statusCode: sizeSnapshotResponse.status,
      body: JSON.stringify(
        `CircleCI API returned ${sizeSnapshotResponse.status} ${sizeSnapshotResponse.statusText}`,
      ),
    };
  }

  const sizeSnapshotJson = await sizeSnapshotResponse.json();
  const bodyRaw = JSON.stringify(sizeSnapshotJson);
  const bodyBuffer = await gzip(bodyRaw, { level: 9 });

  return {
    statusCode: 200,
    headers: {
      ...(enableCacheControl ? { 'Cache-Control': 'immutable, max-age=86400' } : {}),
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      ETag: etag,
    },
    body: bodyBuffer.toString('base64'),
    isBase64Encoded: true,
  };
};
