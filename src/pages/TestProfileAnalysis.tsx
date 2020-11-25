import {
	createContext,
	Fragment,
	Suspense,
	useContext,
	useLayoutEffect,
} from "react";
import { useQuery } from "react-query";
import List from "@material-ui/core/List";
import ListItem from "@material-ui/core/ListItem";
import MuiLink, { LinkProps as MuiLinkProps } from "@material-ui/core/Link";
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

function useTestProfileParams() {
	return useParams() as { buildNumber: string };
}

const ProfiledTestsContext = createContext<TestProfiles>(null!);

interface TimingAnalysisProps {
	timings: number[];
	format: (n: number) => string;
}

function TimingAnalysisMean(props: TimingAnalysisProps) {
	const { format, timings } = props;
	const mean = timings.sort((a, b) => a - b)[timings.length >> 1];

	return <Fragment>{format(mean)}</Fragment>;
}

function formatMs(ms: number): string {
	return ms.toFixed(2);
}

function ProfilerInteractions(props: {
	interactions: { id: number; name: string }[];
}) {
	const interactions = props.interactions.map((interaction) => {
		const traceByStackMatch = interaction.name.match(
			/^([^:]+):(\d+):\d+ \(([^)]+)\)$/
		);
		if (traceByStackMatch === null) {
			return <li key={interaction.id}>{interaction.name}</li>;
		}
		const [, filename, lineNumber, interactionName] = traceByStackMatch;
		return (
			// TOOD: get PR for the current build
			<ListItem key={interaction.id}>
				<Link
					href={`https://github.com/eps1lon/material-ui/tree/test/benchmark/${filename}#L${lineNumber}`}
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
		const testProfiles = profile[testId];
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
					const interaction =
						profilesByBrowserName[browserName][interactionIndex];
					interaction.actualDuration.push(testProfile.actualDuration);
					interaction.baseDuration.push(testProfile.baseDuration);
					interaction.startTime.push(testProfile.startTime);
					interaction.commitTime.push(testProfile.commitTime);
				});
			}
		}
	});

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
	const apiEndpoint = "https://circleci.com/api/v1.1/";
	const endpoint = `project/github/mui-org/material-ui/${buildNumber}/artifacts`;
	const url = `${apiEndpoint}${endpoint}`;
	const response = await fetch(url);
	const artifactsInfo = await response.json();

	return artifactsInfo;
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
			};
		})
	);
}

function useProfiledTests(buildNumber: number): TestProfiles {
	const infos = useTestProfileArtifactsInfos(buildNumber);
	const testProfileArtifactResponse = useQuery(
		["profile-reports", infos],
		fetchTestProfileArtifacts
	);
	return testProfileArtifactResponse.data!;
}

interface CircleCITestProfileAnalysisProps {
	buildNumber: string | null;
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

	return (
		<ol>
			{testIdsWithProfilingData.map((testId) => {
				return <ProfileAnalysis key={testId} testId={testId} />;
			})}
		</ol>
	);
}

function CircleCITestProfileAnalysis(props: CircleCITestProfileAnalysisProps) {
	const buildNumber = parseInt(props.buildNumber!, 10);
	if (Number.isNaN(buildNumber)) {
		throw new Error(`Unable to convert '${props.buildNumber}' to a number`);
	}

	const profiledTests = useProfiledTests(buildNumber);

	return (
		<ProfiledTestsContext.Provider value={profiledTests}>
			<Routes>
				<Route path="" element={<ProfiledTests />} />
				<Route path="details/:testId" element={<ProfileAnalysisDetails />} />
			</Routes>
		</ProfiledTestsContext.Provider>
	);
}

export default function TestProfileAnalysis() {
	const { buildNumber } = useTestProfileParams();

	return (
		<Fragment>
			<Heading level="1">Test profiling analysis</Heading>
			<Suspense
				fallback={
					<p>
						Loading comparison for build <em>{buildNumber}</em>
					</p>
				}
			>
				<ErrorBoundary
					fallback={
						<p>
							Unable to analyse test profile of build <em>{buildNumber}</em>
						</p>
					}
				>
					<CircleCITestProfileAnalysis buildNumber={buildNumber} />
				</ErrorBoundary>
			</Suspense>
		</Fragment>
	);
}
