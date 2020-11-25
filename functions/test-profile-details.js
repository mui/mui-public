const fetch = require("node-fetch");

async function fetchCircleCIApiV2(endpoint) {
	const apiEndpoint = `https://circleci.com/api/v2/`;
	const url = `${apiEndpoint}${endpoint}`;

	console.log(url);
	const response = await fetch(url, {
		headers: { "Circle-Token": process.env.CIRCLE_TOKEN },
	});
	const json = await response.json();
	return json;
}

async function fetchCircleCIJobDetails(jobNumber) {
	return fetchCircleCIApiV2(
		`project/github/mui-org/material-ui/job/${jobNumber}`
	);
}

async function fetchCircleCIPipelineDetails(pipelineId) {
	return fetchCircleCIApiV2(`pipeline/${pipelineId}`);
}

/**
 * netlify function that wraps CircleCI API v2 which requires authentification.
 *
 * @param {*} event
 * @param {*} context
 */
exports.handler = async function fetchTestProfileDetails(event, context) {
	const { queryStringParameters } = event;

	const jobNumber = parseInt(queryStringParameters.jobNumber, 10);
	if (Number.isNaN(jobNumber)) {
		return {
			statusCode: 500,
			body: JSON.stringify(
				`Given query param jobNumber is not a number. Received '${queryStringParameters.buildNumber}'.`
			),
		};
	}

	const job = await fetchCircleCIJobDetails(jobNumber);
	const pipeline = await fetchCircleCIPipelineDetails(job.pipeline.id);

	const details = {
		codeUrl: `${pipeline.vcs.origin_repository_url}/tree/${pipeline.vcs.revision}/`,
		pullRequestNumber: +pipeline.vcs.review_id,
		reviewUrl: pipeline.vcs.review_url,
		webUrl: job.web_url,
	};

	return {
		statusCode: 200,
		headers: {
			// Even though the function implementation might change (making the response not immutable).
			// Since this is a developer tool we can always advise to clear cache.
			"Cache-Control": "immutable, max-age=86400",
		},
		// TODO: minify
		body: JSON.stringify(details, null, 2),
	};
};
