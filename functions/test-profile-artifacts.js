const fetch = require("node-fetch");

/**
 * @returns {Array<{pretty_path: string, url: string}>}
 */
async function fetchCircleCIArtifactsInfo(buildNumber) {
	const apiEndpoint = "https://circleci.com/api/v1.1/";
	const endpoint = `project/github/mui-org/material-ui/${buildNumber}/artifacts`;
	const url = new URL(`${apiEndpoint}${endpoint}`);
	const response = await fetch(url);
	const artifactsInfo = await response.json();

	return artifactsInfo;
}

/**
 * @param {number} buildNumber
 */
async function fetchTestProfileArtifacts(buildNumber) {
	const artifactsInfo = await fetchCircleCIArtifactsInfo(buildNumber);
	const testProfileArtifactsInfo = artifactsInfo
		.map((artifactInfo) => {
			const match = artifactInfo.pretty_path.match(
				/^react-profiler-report\/karma\/([^/]+)\/(\d+)\.json$/
			);
			if (match === null) {
				return null;
			}
			const [, browserName, timestampRaw] = match;
			const timestamp = parseInt(timestampRaw, 10);

			return {
				browserName,
				timestamp,
				url: artifactInfo.url,
			};
		})
		.filter((maybeTestProfileArtifact) => {
			return maybeTestProfileArtifact !== null;
		});

	const testProfileArtifacts = await Promise.all(
		testProfileArtifactsInfo.map(async (artifactInfo) => {
			const { url, ...meta } = artifactInfo;

			const artifactResponse = await fetch(url);
			const profile = await artifactResponse.json();

			return {
				...meta,
				profile,
			};
		})
	);

	return {
		statusCode: 200,
		body: JSON.stringify(testProfileArtifacts),
	};
}

/**
 * Downloads all test_profile artifacts that include profiles.
 *
 * We do this to circumvent CORS (from `fetch(artifact.url)`).
 * As a nice side-effect we can batch multiple client side-requests into a single client-side request
 * that fans out into muliple server-side requests.
 * This reduces header-overhead on the client.
 *
 * @param {*} event
 * @param {*} context
 */
exports.handler = function fetchTestProfileArtifactsHandler(event, context) {
	const { queryStringParameters } = event;
	const buildNumber = parseInt(queryStringParameters.buildNumber, 10);

	if (Number.isNaN(buildNumber)) {
		return {
			statusCode: 500,
			body: JSON.stringify(
				`Given query param buildNumber is not a number. Received '${queryStringParameters.buildNumber}'.`
			),
		};
	}

	return fetchTestProfileArtifacts(buildNumber);
};
