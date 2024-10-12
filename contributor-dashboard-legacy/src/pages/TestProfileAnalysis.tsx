import {
	createContext,
	Fragment,
	Suspense,
	useContext,
	useEffect,
	useLayoutEffect,
} from "react";
import { useQuery } from "react-query";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import MuiLink, { LinkProps as MuiLinkProps } from "@mui/material/Link";
import {
	Link as RouterLink,
	LinkProps as RouterLinkProps,
	Route,
	Routes,
	useLocation,
	useParams,
} from "react-router-dom";
import ErrorBoundary from "../components/ErrorBoundary";
import Heading from "../components/Heading";

async function fetchTestProfileDetails(
	queryKey: unknown,
	jobNumber: number
): Promise<TestProfileDetails> {
	const url = `/.netlify/functions/test-profile-details?jobNumber=${jobNumber}`;
	const response = await fetch(url);
	const testProfileDetails = await response.json();
	return testProfileDetails;
}

const CircleCIJobContext = createContext<number>(null!);

interface TestProfileDetails {
	/**
	 * Link to source on GitHub
	 */
	codeUrl: string;
	label: string;
	/**
	 * Link to review UI that created this profile
	 */
	reviewUrl: string;
	/**
	 * Link to CircleCI UI that created this profile.
	 */
	webUrl: string;
}
function useTestProfileDetails(): TestProfileDetails {
	const buildId = useContext(CircleCIJobContext);
	const testProfileDetailsResponse = useQuery(
		["circleci-pipeline-details", buildId],
		fetchTestProfileDetails
	);

	return testProfileDetailsResponse.data!;
}

function Link(
	props: {
		state?: RouterLinkProps["state"];
		to?: RouterLinkProps["to"];
	} & MuiLinkProps
) {
	const { state, to, ...other } = props;
	if (to === undefined) {
		return <MuiLink {...other} />;
	}
	return <MuiLink component={RouterLink} state={state} to={to} {...other} />;
}

interface ProfilerReport {
	phase: "mount" | "update";
	actualDuration: number;
	baseDuration: number;
	startTime: number;
	commitTime: number;
	interactions: { id: number; name: string }[];
}

interface TestProfile {
	browserName: string;
	profile: Record<string, ProfilerReport[]>;
}
type TestProfiles = TestProfile[];

const ProfiledTestsContext = createContext<TestProfiles>(null!);

interface TimingAnalysisProps {
	timings: number[];
	format: (n: number) => string;
}

function TimingAnalysisMean(props: TimingAnalysisProps) {
	const { format, timings } = props;
	const mean = timings.sort((a, b) => a - b)[timings.length >> 1];

	const details = `mean:\n  ${mean}\nvalues:\n${timings.join("\n")}`;

	return <span title={details}>{format(mean)}</span>;
}

function formatMs(ms: number): string {
	return ms.toFixed(2);
}

function ProfilerInteractions(props: {
	interactions: { id: number; name: string }[];
}) {
	const testProfileDetails = useTestProfileDetails();

	const interactions = props.interactions.map((interaction) => {
		const traceByStackMatch = interaction.name.match(
			/^([^:]+):(\d+):\d+ \(([^)]+)\)$/
		);
		if (traceByStackMatch === null) {
			console.log(interaction.name);
			const unknownLineMatch = interaction.name.match(
				/^unknown line \(([^)]+)\)$/
			);
			return (
				<ListItem key={interaction.id}>
					{unknownLineMatch?.[1] ?? interaction.name}
				</ListItem>
			);
		}
		const [, filename, lineNumber, interactionName] = traceByStackMatch;
		return (
			<ListItem key={interaction.id}>
				<Link
					href={`${testProfileDetails.codeUrl}/${filename}#L${lineNumber}`}
					rel="noreferrer noopener"
					target="_blank"
				>
					{interactionName}@L{lineNumber}
				</Link>
			</ListItem>
		);
	});

	return (
		<List dense disablePadding>
			{interactions}
		</List>
	);
}

function ProfileAnalysisDetails() {
	const { testId } = useParams();
	const profiledTests = useContext(ProfiledTestsContext);

	const profilesByBrowserName: Record<
		string,
		Array<{
			phase: ProfilerReport["phase"];
			actualDuration: ProfilerReport["actualDuration"][];
			baseDuration: ProfilerReport["baseDuration"][];
			startTime: ProfilerReport["startTime"][];
			commitTime: ProfilerReport["commitTime"][];
			interactions: ProfilerReport["interactions"];
		}>
	> = {};
	profiledTests.forEach(({ browserName, profile }) => {
		const testProfiles = profile[testId!];
		if (testProfiles?.length > 0) {
			// squash {a: T, b: U}[] to {a: T[], b: U[]}
			if (profilesByBrowserName[browserName] === undefined) {
				profilesByBrowserName[browserName] = testProfiles.map((testProfile) => {
					return {
						phase: testProfile.phase,
						actualDuration: [testProfile.actualDuration],
						baseDuration: [testProfile.baseDuration],
						startTime: [testProfile.startTime],
						commitTime: [testProfile.commitTime],
						interactions: testProfile.interactions,
					};
				});
			} else {
				testProfiles.forEach((testProfile, interactionIndex) => {
					let interaction =
						profilesByBrowserName[browserName][interactionIndex];

					if (interaction === undefined) {
						// invariant number of interactions in
						// 209850/details/<Accordion%20%2F>%20should%20be%20controlled in FireFox
						profilesByBrowserName[browserName][interactionIndex] = {
							phase: testProfile.phase,
							actualDuration: [testProfile.actualDuration],
							baseDuration: [testProfile.baseDuration],
							startTime: [testProfile.startTime],
							commitTime: [testProfile.commitTime],
							interactions: testProfile.interactions,
						};
					} else {
						interaction.actualDuration.push(testProfile.actualDuration);
						interaction.baseDuration.push(testProfile.baseDuration);
						interaction.startTime.push(testProfile.startTime);
						interaction.commitTime.push(testProfile.commitTime);
					}
				});
			}
		}
	});

	const profileDetails = useTestProfileDetails();
	useTitle(`${profileDetails.label}: ${testId}`);

	return (
		<Fragment>
			<Link to="../..">Back</Link>
			<table>
				<caption>
					Profiles for <em>{testId}</em>
				</caption>
				<thead>
					<tr>
						{Object.keys(profilesByBrowserName).map((browserName) => {
							return <th key={browserName}>{browserName}</th>;
						})}
					</tr>
				</thead>
				<tbody>
					<tr>
						{Object.keys(profilesByBrowserName).map((browserName) => {
							const renders = profilesByBrowserName[browserName];

							return (
								<td key={browserName}>
									<table>
										<thead>
											<tr>
												<th>phase</th>
												<th>actual</th>
												<th>base</th>
												<th>interactions</th>
											</tr>
										</thead>
										<tbody>
											{renders.map((render, interactionIndex) => {
												return (
													<tr key={interactionIndex}>
														<td>{render.phase}</td>
														<td
															align="right"
															style={{ fontVariantNumeric: "tabular-nums" }}
														>
															<TimingAnalysisMean
																format={formatMs}
																timings={render.actualDuration}
															/>
														</td>
														<td
															align="right"
															style={{ fontVariantNumeric: "tabular-nums" }}
														>
															<TimingAnalysisMean
																format={formatMs}
																timings={render.baseDuration}
															/>
														</td>
														<td>
															<ProfilerInteractions
																interactions={render.interactions}
															/>
														</td>
													</tr>
												);
											})}
										</tbody>
									</table>
								</td>
							);
						})}
					</tr>
				</tbody>
			</table>
			<Heading level="2">Explainer</Heading>
			<dl>
				<dt>actual</dt>
				<dd>mean actualDuration in ms</dd>
				<dt>base</dt>
				<dd>mean baseDuration in ms</dd>
				<dt>interactions</dt>
				<dd>traced interactions linking to the code that triggered it.</dd>
			</dl>
			<p>
				For more information check{" "}
				<Link
					href="https://github.com/reactjs/rfcs/blob/master/text/0051-profiler.md#detailed-design"
					rel="noreferrer noopener"
					target="_blank"
				>
					React.Profiler RFC
				</Link>
			</p>
		</Fragment>
	);
}

let scrollYBeforeDetailsClick: null | number = null;

interface ProfileAnalysisProps {
	testId: string;
}
function ProfileAnalysis(props: ProfileAnalysisProps) {
	const { testId } = props;

	return (
		<li>
			<Link
				onClick={() => {
					scrollYBeforeDetailsClick = window.scrollY;
				}}
				to={`details/${encodeURIComponent(testId)}`}
			>
				{testId}
			</Link>
		</li>
	);
}

interface TestProfileArtifactsInfo {
	browserName: string;
	timestamp: number;
	url: string;
}

async function fetchCircleCIArtifactsInfos(
	buildNumber: number
): Promise<Array<{ pretty_path: string; url: string }>> {
	const apiEndpoint = `https://circleci.com/api/v1.1/`;
	const url = `${apiEndpoint}project/github/mui/material-ui/${buildNumber}/artifacts`;

	const response = await fetch(url);
	const json = await response.json();
	return json;
}

async function fetchTestProfileArtifactsInfos(
	queryKey: unknown,
	buildNumber: number
): Promise<TestProfileArtifactsInfo[]> {
	const infos = await fetchCircleCIArtifactsInfos(buildNumber);

	return infos
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
		.filter(
			(
				maybeTestProfileArtifact
			): maybeTestProfileArtifact is TestProfileArtifactsInfo => {
				return maybeTestProfileArtifact !== null;
			}
		);
}

function useTestProfileArtifactsInfos(
	buildNumber: number
): TestProfileArtifactsInfo[] {
	const testProfileArtifactsInfosResponse = useQuery(
		["test-profile-artifacts", buildNumber],
		fetchTestProfileArtifactsInfos
	);

	return testProfileArtifactsInfosResponse.data!;
}

function fetchTestProfileArtifacts(
	queryKey: unknown,
	infos: TestProfileArtifactsInfo[]
): Promise<TestProfile[]> {
	return Promise.all(
		infos.map(async (info) => {
			const url = `/.netlify/functions/test-profile-artifact?url=${info.url}`;
			const response = await fetch(url);
			const testProfile: TestProfile["profile"] = await response.json();

			return {
				browserName: info.browserName,
				profile: testProfile,
				timestamp: info.timestamp,
			};
		})
	);
}

function useTitle(title: string): void {
	useEffect(() => {
		const originalTitle = document.title;

		return () => {
			document.title = originalTitle;
		};
	}, []);

	useEffect(() => {
		document.title = title;
	}, [title]);
}

function useProfiledTests(buildNumber: number): TestProfiles {
	const infos = useTestProfileArtifactsInfos(buildNumber);
	const testProfileArtifactResponse = useQuery(
		["profile-reports", infos],
		fetchTestProfileArtifacts,
		// TODO: Let netlify functions do the caching once https://community.netlify.com/t/netlify-function-responds-with-wrong-body/27138 is resolved.
		{ cacheTime: 7 * 24 * 60 * 60, staleTime: 24 * 60 * 60 }
	);
	return testProfileArtifactResponse.data!;
}

function ProfiledTests() {
	const profiledTests = useContext(ProfiledTestsContext);

	const testIdsWithProfilingData = Array.from(
		new Set(
			profiledTests.reduce((testIdsDuplicated, { profile }) => {
				return testIdsDuplicated.concat(
					Object.keys(profile).filter((testId) => {
						return profile[testId].length > 0;
					})
				);
			}, [] as string[])
		)
	).sort((a, b) => {
		return a.localeCompare(b);
	});

	const location = useLocation();
	useLayoutEffect(() => {
		// native scroll restoration does not work when e.g. navigating backwards.
		// So we restore it manually.
		if (scrollYBeforeDetailsClick !== null) {
			window.scrollTo(0, scrollYBeforeDetailsClick);
			scrollYBeforeDetailsClick = null;
		}
	}, [location]);

	const profileDetails = useTestProfileDetails();

	useTitle(`${profileDetails.label} | Profile Dashboard`);

	return (
		<Fragment>
			<Heading level="2">
				Tests for{" "}
				<Link
					href={profileDetails.reviewUrl}
					rel="noopener noreferrer"
					target="_blank"
				>
					{profileDetails.label}
				</Link>
			</Heading>
			<ol>
				{testIdsWithProfilingData.map((testId) => {
					return <ProfileAnalysis key={testId} testId={testId} />;
				})}
			</ol>
		</Fragment>
	);
}

function CircleCITestProfileAnalysis() {
	const { buildNumber } = useParams();
	const profiledTests = useProfiledTests(+buildNumber!);

	return (
		<div>
			<CircleCIJobContext.Provider value={+buildNumber!}>
				<ProfiledTestsContext.Provider value={profiledTests}>
					<Routes>
						<Route path="" element={<ProfiledTests />} />
						<Route
							path="details/:testId"
							element={<ProfileAnalysisDetails />}
						/>
					</Routes>
				</ProfiledTestsContext.Provider>
			</CircleCIJobContext.Provider>
		</div>
	);
}

export default function TestProfileAnalysis() {
	const { buildNumber } = useParams();

	return (
		<Fragment>
			<Heading level="1">Test profiling analysis</Heading>
			<div>
				<ErrorBoundary
					fallback={
						<p>
							Unable to analyse test profile of build <em>{buildNumber}</em>
						</p>
					}
				>
					<CircleCITestProfileAnalysis />
				</ErrorBoundary>
			</div>
		</Fragment>
	);
}
