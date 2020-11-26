const crypto = require("crypto");
const fetch = require("node-fetch");
const { URL } = require("url");
const util = require("util");
const zlib = require("zlib");

const gzip = util.promisify(zlib.gzip);

/**
 * @param {string} string
 */
function md5(string) {
	return crypto.createHash("md5").update(string).digest("hex");
}

/**
 *
 * @param {object} context
 * @param {URL} context.url
 * @param {string} context.version - to purge the cache
 */
function computeEtag(context) {
	const { url, version } = context;
	const epoch = "v1";
	return md5(`${epoch}v${version}-${url}`);
}

/**
 * Downloads a test_profile artifact.
 *
 * We do this to circumvent CORS (from `fetch(artifact.url)`).
 * As a nice side-effect we can apply some better Cache-Control defaults.
 * CircleCI API does not send Cache-Control headers in their API.
 *
 * @param {*} event
 * @param {*} context
 */
exports.handler = async function fetchTestProfileArtifactHandler(
	event,
	context
) {
	const { queryStringParameters } = event;

	let url = null;
	try {
		url = new URL(queryStringParameters.url);
	} catch (error) {
		return {
			statusCode: 500,
			body: JSON.stringify(
				`Given query param buildNumber is not a number. Received '${queryStringParameters.buildNumber}'.`
			),
		};
	}

	const ifNoneMatch = event.headers["if-none-match"];
	const etag = computeEtag({
		url,
		version: context.functionVersion,
	});
	console.log(url, etag);

	if (ifNoneMatch === etag) {
		// No need to download every artifact again since they're immutable.
		return {
			statusCode: 304,
			headers: {
				"Cache-Control": "immutable, max-age=86400",
				ETag: etag,
			},
		};
	}

	const testProfileArtifactResponse = await fetch(url);
	if (!testProfileArtifactResponse.ok) {
		return {
			statusCode: 500,
			body: JSON.stringify(
				`Unable to get CircleCI response for '${url}' that is OK. Got ${testProfileArtifactResponse.status}`
			),
		};
	}

	const testProfileArtifact = await testProfileArtifactResponse.json();

	const bodyRaw = JSON.stringify(testProfileArtifact);
	const bodyBuffer = await gzip(bodyRaw, { level: 9 });

	return {
		statusCode: 200,
		headers: {
			// Even though the function implementation might change (making the response not immutable).
			// Since this is a developer tool we can always advise to clear cache.
			"Cache-Control": "immutable, max-age=86400",
			"Content-Type": "application/json",
			"Content-Encoding": "gzip",
			ETag: etag,
		},
		body: bodyBuffer.toString("base64"),
		isBase64Encoded: true,
	};
};
