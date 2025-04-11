// @ts-check

/**
 * @typedef {import('@netlify/functions').Handler} Handler
 */

/**
 * netlify function that wraps CircleCI API v2 which requires CORS.
 */
exports.handler = /** @type {Handler} */ (
  async function circleCIArtefact(event) {
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

    const url = `https://circleci.com/api/v2/project/github/mui/material-ui/${buildNumber}/artifacts`;
    const artifactsResponse = await fetch(url);

    if (!artifactsResponse.ok) {
      return {
        statusCode: artifactsResponse.status,
        body: JSON.stringify(
          `CircleCI API returned ${artifactsResponse.status} ${artifactsResponse.statusText}`,
        ),
      };
    }

    const artifactsJson = await artifactsResponse.json();
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

    return {
      statusCode: 200,
      body: JSON.stringify(sizeSnapshotJson),
    };
  }
);
