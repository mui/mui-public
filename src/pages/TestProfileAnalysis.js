import { createContext, Fragment, Suspense, useContext } from "react";
import { useLocation } from "react-router";
import { useQuery } from "react-query";
import Accordion from "@material-ui/core/Accordion";
import AccordionDetails from "@material-ui/core/AccordionDetails";
import AccordionSummary from "@material-ui/core/AccordionSummary";
import ErrorBoundary from "../components/ErrorBoundary";
import Heading from "../components/Heading";

function useTestProfileParams() {
	const { search } = useLocation();
	const params = new URLSearchParams(search);

	return {
		buildNumber: params.get("buildNumber"),
	};
}

async function fetchTestProfiles(queryKey, buildNumber) {
	const response = await fetch(
		`/.netlify/functions/test-profile-artifacts?buildNumber=${buildNumber}`
	);
	return response.json();
}

const TestProfilesContext = createContext(null);

function TimingAnalysis(props) {
	const { format, timings } = props;
	const mean = timings.sort((a, b) => a - b)[timings.length >> 1];
	console.log(timings);
	return (
		<Fragment>
			mean: <em>{format(mean)}</em>
		</Fragment>
	);
}

function formatMs(ms) {
	return ms.toFixed(2) + "ms";
}

function ProfileAnalysisDetails(props) {
	const { testId } = props;
	const testProfiles = useContext(TestProfilesContext);

	const profilesByBrowserName = {};
	testProfiles.forEach(({ browserName, profile }) => {
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
		<table>
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
						const interactions = profilesByBrowserName[browserName];
						console.log(interactions);
						return (
							<td key={browserName}>
								<table>
									<thead>
										<tr>
											<th>phase</th>
											<th>actualDuration</th>
											<th>baseDuration</th>
										</tr>
									</thead>
									<tbody>
										{interactions.map((interaction, interactionIndex) => {
											return (
												<tr key={interactionIndex}>
													<td>{interaction.phase}</td>
													<td>
														<TimingAnalysis
															format={formatMs}
															timings={interaction.actualDuration}
														/>
													</td>
													<td>
														<TimingAnalysis
															format={formatMs}
															timings={interaction.baseDuration}
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
	);
}
function ProfileAnalysis(props) {
	const { testId } = props;

	return (
		<Accordion component="li" TransitionProps={{ unmountOnExit: true }}>
			<AccordionSummary>{testId}</AccordionSummary>
			<AccordionDetails>
				<ProfileAnalysisDetails testId={testId} />
			</AccordionDetails>
		</Accordion>
	);
}

function useTestProfiles(buildNumber) {
	const testProfilesResponse = useQuery(
		["profile-reports", buildNumber],
		fetchTestProfiles
	);
	return testProfilesResponse.data;
}

function CircleCITestProfileAnalysis(props) {
	const { buildNumber } = props;

	const testProfiles = useTestProfiles(buildNumber);
	const testIdsWithProfilingData = Array.from(
		new Set(
			testProfiles.reduce((testIdsDuplicated, { profile }) => {
				return testIdsDuplicated.concat(
					Object.keys(profile).filter((testId) => {
						return profile[testId].length > 0;
					})
				);
			}, [])
		)
	).sort((a, b) => {
		return a.localeCompare(b);
	});

	return (
		<TestProfilesContext.Provider value={testProfiles}>
			<ol>
				{testIdsWithProfilingData.map((testId) => {
					return <ProfileAnalysis key={testId} testId={testId} />;
				})}
			</ol>
		</TestProfilesContext.Provider>
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
