const crypto = require("crypto");
const fetch = require("node-fetch");
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
 * @param {number} context.buildNumber
 * @param {unknown[] | null} context.artifactsInfo
 * @param {string} context.version - to purge the cache
 */
function computeEtag(context) {
	const { buildNumber, artifactsInfo, version } = context;
	if (artifactsInfo === null) {
		return md5(`v${version}-${buildNumber}`);
	}
	return md5(`v${version}-${buildNumber}-${artifactsInfo.length}`);
}

/**
 * @returns {Array<{pretty_path: string, url: string}> | null}
 */
async function fetchCircleCIArtifactsInfo(buildNumber) {
	const apiEndpoint = "https://circleci.com/api/v1.1/";
	const endpoint = `project/github/mui-org/material-ui/${buildNumber}/artifacts`;
	const url = new URL(`${apiEndpoint}${endpoint}`);
	const response = await fetch(url);
	if (response.ok) {
		const artifactsInfo = await response.json();

		return artifactsInfo;
	} else {
		// Assume 404
		return null;
	}
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
exports.handler = async function fetchTestProfileArtifactsHandler(
	event,
	context
) {
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

	const ifNoneMatch = event.headers["if-none-match"];
	const artifactsInfo = await fetchCircleCIArtifactsInfo(buildNumber);
	const etag = computeEtag({
		buildNumber,
		artifactsInfo,
		version: context.functionVersion,
	});

	if (artifactsInfo === null) {
		return {
			statusCode: 404,
			headers: {
				"Cache-Control": `max-age=60, stale-while-revalidate=86400`,
				ETag: etag,
			},
			body: JSON.stringify({
				message: "CircleCI build not found.",
			}),
		};
	}

	// No artifacts yet.
	// We know this because this particular type of build will create artifacts.
	if (artifactsInfo.length === 0) {
		return {
			statusCode: 404,
			headers: {
				// Will "soon-ish" have artifacts so F5-spam must be accounted for.
				"Cache-Control": `max-age=1, stale-while-revalidate=60`,
				ETag: etag,
			},
			body: JSON.stringify({
				message:
					"Artifacts not created yet. Check back once the CircleCI build finished.",
			}),
		};
	}

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

	const bodyRaw = JSON.stringify(testProfileArtifacts);
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
