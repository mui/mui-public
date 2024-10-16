import * as React from "react";
import { useLocation } from "react-router";
import { useQuery } from "react-query";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Link from "@mui/material/Link";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import prettyBytes from "pretty-bytes";
import styled from "@emotion/styled";
import ErrorBoundary from "../components/ErrorBoundary";
import Heading from "../components/Heading";

interface CircleCIApiArtifacts {
	items: ReadonlyArray<{ path: string; url: string }>;
}

interface SizeSnapshot {
	[bundleId: string]: { parsed: number; gzip: number };
}

async function fetchSizeSnapshotCircleCI(
	buildNumber: number,
): Promise<SizeSnapshot> {
	const response = await fetch(
		`/.netlify/functions/circle-ci-artifacts?buildNumber=${buildNumber}`,
	);
	const body: CircleCIApiArtifacts = await response.json();

	if (response.status === 200) {
		const artifacts = body.items;
		const artifact = artifacts.find(
			(artifactI) => artifactI.path === "size-snapshot.json",
		);

		const downloadURL = new URL(
			"/.netlify/functions/test-profile-artifact",
			document.baseURI,
		);
		downloadURL.searchParams.set("url", artifact!.url);

		return downloadSnapshot("size-snapshot-circleci", downloadURL.toString());
	}

	throw new Error(`${response.status}: ${response.statusText}`);
}

async function fetchSizeSnapshot(
	key: unknown,
	{ circleCIBuildNumber }: { circleCIBuildNumber: number },
): Promise<SizeSnapshot | undefined> {
	return fetchSizeSnapshotCircleCI(circleCIBuildNumber);
}

async function downloadSnapshot(
	key: unknown,
	downloadUrl: string,
): Promise<SizeSnapshot> {
	const response = await fetch(downloadUrl);
	if (!response.ok) {
		throw new Error(
			`Failed to fetch "${downloadUrl}", HTTP ${response.status}`,
		);
	}
	return response.json();
}

function useAzureSizeSnapshot({
	circleCIBuildNumber,
}: {
	circleCIBuildNumber: number;
}): SizeSnapshot {
	const { data: sizeSnapshot } = useQuery(
		[
			"azure-artifacts",
			{
				circleCIBuildNumber,
			},
		],
		fetchSizeSnapshot,
	);

	// NonNullable due to Suspense
	return sizeSnapshot!;
}

function useS3SizeSnapshot(ref: string, commitId: string): SizeSnapshot {
	const downloadUrl = `https://s3.eu-central-1.amazonaws.com/mui-org-ci/artifacts/${encodeURIComponent(ref)}/${encodeURIComponent(commitId)}/size-snapshot.json`;

	const { data: sizeSnapshot } = useQuery(
		["s3-snapshot-download", downloadUrl],
		downloadSnapshot,
	);

	// NonNullable due to Suspense
	return sizeSnapshot!;
}

/**
 * Generates a user-readable string from a percentage change
 * @param change
 * @param goodEmoji emoji on reduction
 * @param badEmoji emoji on increase
 */
function addPercent(
	change: number,
	goodEmoji: string = "",
	badEmoji: string = ":small_red_triangle:",
): string {
	const formatted = (change * 100).toFixed(2);
	if (/^-|^0(?:\.0+)$/.test(formatted)) {
		return `${formatted}% ${goodEmoji}`;
	}
	return `+${formatted}% ${badEmoji}`;
}

function formatDiff(absoluteChange: number, relativeChange: number): string {
	if (absoluteChange === 0) {
		return "--";
	}

	const trendIcon = absoluteChange < 0 ? "▼" : "▲";

	return `${trendIcon} ${prettyBytes(absoluteChange, {
		signed: true,
	})} (${addPercent(relativeChange, "", "")})`;
}

const BundleCell = styled(TableCell)`
	max-width: 40ch;
`;

const CompareTable = React.memo(function CompareTable({
	entries,
	getBundleLabel,
	renderBundleLabel = getBundleLabel,
}: {
	entries: [string, Size][];
	getBundleLabel: (bundleId: string) => string;
	renderBundleLabel?: (bundleId: string) => string;
}) {
	const rows = React.useMemo(() => {
		return (
			entries
				.map(([bundleId, size]): [string, Size & { id: string }] => [
					getBundleLabel(bundleId),
					{ ...size, id: bundleId },
				])
				// orderBy(|parsedDiff| DESC, |gzipDiff| DESC, name ASC)
				.sort(([labelA, statsA], [labelB, statsB]) => {
					const compareParsedDiff =
						Math.abs(statsB.parsed.absoluteDiff) -
						Math.abs(statsA.parsed.absoluteDiff);
					const compareGzipDiff =
						Math.abs(statsB.gzip.absoluteDiff) -
						Math.abs(statsA.gzip.absoluteDiff);
					const compareName = labelA.localeCompare(labelB);

					if (compareParsedDiff === 0 && compareGzipDiff === 0) {
						return compareName;
					}
					if (compareParsedDiff === 0) {
						return compareGzipDiff;
					}
					return compareParsedDiff;
				})
		);
	}, [entries, getBundleLabel]);

	return (
		<Table>
			<TableHead>
				<TableRow>
					<BundleCell>bundle</BundleCell>
					<TableCell align="right">Size change</TableCell>
					<TableCell align="right">Size</TableCell>
					<TableCell align="right">Gzip change</TableCell>
					<TableCell align="right">Gzip</TableCell>
				</TableRow>
			</TableHead>
			<TableBody>
				{rows.map(([label, { parsed, gzip, id }]) => {
					return (
						<TableRow key={label}>
							<BundleCell>{renderBundleLabel(id)}</BundleCell>
							<TableCell align="right">
								{formatDiff(parsed.absoluteDiff, parsed.relativeDiff)}
							</TableCell>
							<TableCell align="right">{prettyBytes(parsed.current)}</TableCell>
							<TableCell align="right">
								{formatDiff(gzip.absoluteDiff, gzip.relativeDiff)}
							</TableCell>
							<TableCell align="right">{prettyBytes(gzip.current)}</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
});

function getMainBundleLabel(bundleId: string): string {
	if (
		bundleId === "packages/material-ui/build/umd/material-ui.production.min.js"
	) {
		return "@mui/material[umd]";
	}
	if (bundleId === "@mui/material/Textarea") {
		return "TextareaAutosize";
	}
	if (bundleId === "docs.main") {
		return "docs:/_app";
	}
	if (bundleId === "docs.landing") {
		return "docs:/";
	}
	// eslint-disable-next-line no-console
	console.log(bundleId);
	return (
		bundleId
			// package renames
			.replace(/^@material-ui\/core$/, "@mui/material")
			.replace(/^@material-ui\/core.legacy$/, "@mui/material.legacy")
			.replace(/^@material-ui\/icons$/, "@mui/material-icons")
			.replace(/^@material-ui\/unstyled$/, "@mui/core")
			// org rename
			.replace(/^@material-ui\/([\w-]+)$/, "@mui/$1")
			// path renames
			.replace(
				/^packages\/material-ui\/material-ui\.production\.min\.js$/,
				"packages/mui-material/material-ui.production.min.js",
			)
			.replace(/^@material-ui\/core\//, "")
			.replace(/\.esm$/, "")
	);
}

function getPageBundleLabel(bundleId: string): string {
	// a page
	if (bundleId.startsWith("docs:/")) {
		const page = bundleId.replace(/^docs:/, "");
		return page;
	}

	// shared
	return bundleId;
}

interface Size {
	parsed: {
		previous: number;
		current: number;
		absoluteDiff: number;
		relativeDiff: number;
	};
	gzip: {
		previous: number;
		current: number;
		absoluteDiff: number;
		relativeDiff: number;
	};
}

const nullSnapshot = { parsed: 0, gzip: 0 };
function Comparison({
	baseRef,
	baseCommit,
	circleCIBuildNumber,
	prNumber,
}: {
	baseRef: string;
	baseCommit: string;
	circleCIBuildNumber: number;
	prNumber: number;
}) {
	const baseSnapshot = useS3SizeSnapshot(baseRef, baseCommit);
	const targetSnapshot = useAzureSizeSnapshot({
		circleCIBuildNumber,
	});

	const { main: mainResults, pages: pageResults } = React.useMemo(() => {
		const bundleKeys = Object.keys({ ...baseSnapshot, ...targetSnapshot });

		const main: [string, Size][] = [];
		const pages: [string, Size][] = [];
		bundleKeys.forEach((bundle) => {
			// current vs previous based off: https://github.com/mui/material-ui/blob/f1246e829f9c0fc9458ce951451f43c2f166c7d1/scripts/sizeSnapshot/loadComparison.js#L32
			// if a bundle was added the change should be +inf
			// if a bundle was removed the change should be -100%
			const currentSize = targetSnapshot[bundle] || nullSnapshot;
			const previousSize = baseSnapshot[bundle] || nullSnapshot;

			const entry: [string, Size] = [
				bundle,
				{
					parsed: {
						previous: previousSize.parsed,
						current: currentSize.parsed,
						absoluteDiff: currentSize.parsed - previousSize.parsed,
						relativeDiff: currentSize.parsed / previousSize.parsed - 1,
					},
					gzip: {
						previous: previousSize.gzip,
						current: currentSize.gzip,
						absoluteDiff: currentSize.gzip - previousSize.gzip,
						relativeDiff: currentSize.gzip / previousSize.gzip - 1,
					},
				},
			];

			if (bundle.startsWith("docs:")) {
				pages.push(entry);
			} else {
				main.push(entry);
			}
		});

		return { main, pages };
	}, [baseSnapshot, targetSnapshot]);

	const renderPageBundleLabel = React.useCallback(
		(bundleId) => {
			// a page
			if (bundleId.startsWith("docs:/")) {
				const page = bundleId.replace(/^docs:/, "");
				const host = `https://deploy-preview-${prNumber}--material-ui.netlify.app`;
				return <Link href={`${host}${page}`}>{page}</Link>;
			}

			// shared
			return bundleId;
		},
		[prNumber],
	);

	return (
		<React.Fragment>
			<Accordion defaultExpanded>
				<AccordionSummary>Modules</AccordionSummary>
				<AccordionDetails>
					<CompareTable
						entries={mainResults}
						getBundleLabel={getMainBundleLabel}
					/>
				</AccordionDetails>
			</Accordion>
			<Accordion defaultExpanded={false}>
				<AccordionSummary>Pages</AccordionSummary>
				<AccordionDetails>
					<CompareTable
						entries={pageResults}
						getBundleLabel={getPageBundleLabel}
						renderBundleLabel={renderPageBundleLabel}
					/>
				</AccordionDetails>
			</Accordion>
		</React.Fragment>
	);
}

function useComparisonParams() {
	const { search } = useLocation();
	return React.useMemo(() => {
		const params = new URLSearchParams(search);

		return {
			baseCommit: params.get("baseCommit")!,
			baseRef: params.get("baseRef")!,
			prNumber: +params.get("prNumber")!,
			circleCIBuildNumber: +params.get("circleCIBuildNumber")!,
		};
	}, [search]);
}

function ComparisonErrorFallback({ prNumber }: { prNumber: number }) {
	return (
		<p>
			Could not load comparison for{" "}
			<Link href={`https://github.com/mui/material-ui/pull/${prNumber}`}>
				#{prNumber}
			</Link>
			{". This can happen if the build in the CI job didn't finish yet. "}
			Reload this page once the CI job has finished.
		</p>
	);
}

export default function SizeComparison() {
	const { baseRef, baseCommit, circleCIBuildNumber, prNumber } =
		useComparisonParams();

	return (
		<React.Fragment>
			<Heading level="1">Size comparison</Heading>
			<div>
				<ErrorBoundary
					fallback={<ComparisonErrorFallback prNumber={prNumber} />}
				>
					<Comparison
						baseRef={baseRef}
						baseCommit={baseCommit}
						circleCIBuildNumber={circleCIBuildNumber}
						prNumber={prNumber}
					/>
				</ErrorBoundary>
			</div>
		</React.Fragment>
	);
}
