import * as React from "react";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation } from "react-query";

export default Webpagetests;

function createTest({ label, url }) {
	if (url === null) {
		return Promise.resolve(null);
	}
	const apiUrl = new URL("https://www.webpagetest.org/runtest.php");
	new URLSearchParams({
		f: "json",
		k: "A.e2187e86a47779375c33bd84385934e2",
		label,
		runs: 3,
		url,
		video: 1,
	}).forEach((value, key) => apiUrl.searchParams.append(key, value));

	return fetch(apiUrl).then((response) => response.json());
}

function Webpagetests() {
	const [prNumber, setPrNumber] = React.useState(20549); // TODO default to -1
	const [targetValue, setTargetValue] = React.useState("master");
	const [page, setPage] = React.useState("/");

	const sourceUrl = React.useMemo(() => {
		if (prNumber >= 0) {
			return `https://deploy-preview-${prNumber}--material-ui.netlify.com${page}`;
		}
		return null;
	}, [page, prNumber]);
	const targetUrl = React.useMemo(() => {
		return `https://${targetValue}--material-ui.netlify.com${page}`;
	}, [page, targetValue]);

	const [createSourceTest, { data: sourceTest }] = useMutation(createTest);
	const [createTargetTest, { data: targetTest }] = useMutation(createTest);
	const [isTestPending, startTestTransition] = React.useTransition({
		timeoutMs: 300,
	});
	function handleSubmit(event) {
		event.preventDefault();

		startTestTransition(() => {
			createTargetTest({ label: `${targetValue}`, url: targetUrl });
			createSourceTest({ label: `Pull Request #${prNumber}`, url: sourceUrl });
		});
	}

	return (
		<form aria-label="webpagetests" onSubmit={handleSubmit}>
			<TextField
				inputMode="numeric"
				label="PR number: "
				onChange={(event) => setPrNumber(event.target.value)}
				value={prNumber}
				variant="outlined"
			/>
			<TextField
				helperText="branch name or Netlify deploy ID"
				label="target"
				onChange={(event) => setTargetValue(event.target.value)}
				value={targetValue}
				variant="outlined"
			/>
			<TextField
				label="page"
				onChange={(event) => setPage(event.target.value)}
				value={page}
				variant="outlined"
			/>
			<Button disabled={isTestPending} type="submit">
				{isTestPending ? "Submitting test..." : "Submit"}
			</Button>
			<Paper component="output">
				<WebpagetestResult
					sourceTest={sourceTest}
					sourceUrl={sourceUrl}
					targetTest={targetTest}
					targetUrl={targetUrl}
				/>
			</Paper>
		</form>
	);
}

function WebpagetestResult({ sourceTest, sourceUrl, targetTest, targetUrl }) {
	if (sourceTest === undefined || targetTest === undefined) {
		return null;
	}

	if (sourceTest.statusCode !== 200 || targetTest.statusCode !== 200) {
		if (sourceTest.statusText === targetTest.statusText) {
			return <p>Error: {sourceTest.statusText}</p>;
		}
		return (
			<ul>
				<li>source error: {sourceTest.statusText}</li>
				<li>target error: {targetTest.statusText}</li>
			</ul>
		);
	}

	const comparisonUrl = `https://www.webpagetest.org/video/compare.php?tests=${sourceTest.data.testId},${targetTest.data.testId}`;

	return (
		<details>
			<summary>
				<Typography>
					<Link href={comparisonUrl}>Visual comparison</Link> between{" "}
					<Link href={sourceUrl}>{sourceUrl}</Link> and{" "}
					<Link href={targetUrl}>{targetUrl}</Link>
				</Typography>
			</summary>
			<dl>
				<dt>source</dt>
				<dd>
					<pre>{JSON.stringify(sourceTest, null, 2)}</pre>
				</dd>
				<dt>target</dt>
				<dd>
					<pre>{JSON.stringify(targetTest, null, 2)}</pre>
				</dd>
			</dl>
		</details>
	);
}
