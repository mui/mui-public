const fetch = require("node-fetch");

async function fetchCircleCIApiV2(endpoint) {
	const url = `https://circleci.com/api/v2/${endpoint}`;

	// eslint-disable-next-line no-console
	console.log(url);
	const response = await fetch(url);
	const json = await response.json();
	return json;
}

/**
 * netlify function that wraps CircleCI API v2 which requires authentification.
 *
 * @param {*} event
 * @param {*} context
 */
exports.handler = async function circleCIArtefact(event) {
	const { queryStringParameters } = event;

	const buildNumberParameter = queryStringParameters.buildNumber;
	const buildNumber = parseInt(buildNumberParameter, 10);
	if (Number.isNaN(buildNumber)) {
		return {
			statusCode: 500,
			body: JSON.stringify(
				`Given query param buildNumber is not a number. Received '${buildNumberParameter}'.`,
			),
		};
	}
	// eslint-disable-next-line no-console
	console.log(`fetching details for job #${buildNumber}`);

	const artifacts = await fetchCircleCIApiV2(
		`project/github/mui/material-ui/${buildNumber}/artifacts`,
	);
	const response = {
		statusCode: 200,
		body: JSON.stringify(artifacts),
	};

	return response;
};
