import * as React from "react";
import ExpansionPanel from "@material-ui/core/ExpansionPanel";
import ExpansionPanelDetails from "@material-ui/core/ExpansionPanelDetails";
import ExpansionPanelSummary from "@material-ui/core/ExpansionPanelSummary";
import List from "@material-ui/core/List";
import ListItem from "@material-ui/core/ListItem";
import Link from "@material-ui/core/Link";
import Skeleton from "@material-ui/lab/Skeleton";
import Typography from "@material-ui/core/Typography";
import ExpandMoreIcon from "@material-ui/icons/ExpandMore";
import { usePaginatedQuery } from "react-query";
import styled from "styled-components";
import ErrorBoundary from "../components/ErrorBoundary";
import Heading from "../components/Heading";

const Webpagetests = React.lazy(() => import("../components/Webpagetests"));

export default function Landing() {
	return (
		<React.SuspenseList revealOrder="forwards">
			<Heading level="1">Maintainer Dashboard</Heading>
			<Heading level="2" id="circle-ci-workflows">
				CircleCI workflows
			</Heading>
			<CircleCIWorkflows />
			<Heading level="2" id="webpagetests">
				Webpagetests
			</Heading>
			<React.Suspense fallback="loading webpagetests">
				<Webpagetests />
			</React.Suspense>
		</React.SuspenseList>
	);
}

function CircleCIWorkflows() {
	const workflows = [
		{ name: "pipeline", label: "material-ui@master", branchName: "master" },
		{ name: "typescript-next", label: "typescript@next" },
		{ name: "react-next", label: "react@next" },
	];
	return (
		<React.SuspenseList revealOrder="forwards">
			{workflows.map((workflow) => {
				return (
					<React.Suspense
						fallback={<Skeleton height={48} variant="rect" />}
						key={workflow.name}
					>
						<ErrorBoundary
							fallback={
								<p>Failed fetching CircleCI builds for {workflow.name}</p>
							}
						>
							<CircleCIWorkflow workflow={workflow} />
						</ErrorBoundary>
					</React.Suspense>
				);
			})}
		</React.SuspenseList>
	);
}

function CircleCIWorkflow(props) {
	const { workflow } = props;

	const builds = useRecentBuilds({
		workflowName: workflow.name,
		branchName: workflow.branchName,
	});

	// recent builds first
	const sortedBuilds = builds.sort((a, b) => {
		return new Date(b.stop_time) - new Date(a.stop_time);
	});
	const [lastBuild] = sortedBuilds;

	return (
		<ExpansionPanel>
			<ExpansionPanelSummary
				aria-controls={`circleci-workflow-${workflow.name}-content`}
				id={`circleci-workflow-${workflow.name}-header`}
				expandIcon={<ExpandMoreIcon />}
			>
				<Typography>
					{workflow.label}{" "}
					{lastBuild === undefined ? "state unknown" : lastBuild.status}
				</Typography>
			</ExpansionPanelSummary>
			<ExpansionPanelDetails>
				<CircleCIBuilds builds={sortedBuilds} />
			</ExpansionPanelDetails>
		</ExpansionPanel>
	);
}

const CircleCIBuild = styled(ListItem)`
	display: inline-block;
`;

function CircleCIBuilds(props) {
	const { builds } = props;

	return (
		<List>
			{builds.map((build) => {
				return (
					<CircleCIBuild key={build.build_num}>
						<Link href={build.build_url}>
							{build.workflows.job_name}@{build.branch}
						</Link>
						{" finished "}
						<RelativeTimeTillNow time={build.stop_time} />
					</CircleCIBuild>
				);
			})}
		</List>
	);
}

function useRecentBuilds(filter) {
	const { branchName, workflowName } = filter;
	const [page, setPage] = React.useState(0);
	const { resolvedData: builds } = usePaginatedQuery(
		["circle-ci-builds", page],
		fetchRecentCircleCIBuilds,
		{
			getFetchMore: (lastGroup, allGroups) => {
				return allGroups.length;
			},
		}
	);
	React.useDebugValue(builds);

	const filteredBuilds = React.useMemo(() => {
		return builds.filter((build) => {
			return (
				build.workflows.workflow_name === workflowName &&
				(branchName === undefined || build.branch === branchName)
			);
		});
	}, [branchName, builds, workflowName]);

	if (filteredBuilds.length === 0 && page < 10) {
		setPage(page + 1);
	}

	return React.useMemo(() => filteredBuilds.slice(0, 20), [filteredBuilds]);
}

async function fetchRecentCircleCIBuilds(key, cursor = 0) {
	const url = getCircleCIApiUrl("project/github/mui-org/material-ui", {
		filter: "completed",
		limit: 100,
		offset: 100 * cursor,
	});
	const response = await fetch(url);
	const builds = await response.json();

	return builds;
}

function getCircleCIApiUrl(endpoint, params) {
	const apiEndpoint = "https://circleci.com/api/v1.1/";
	const url = new URL(`${apiEndpoint}${endpoint}`);
	new URLSearchParams({
		...params,
	}).forEach((value, key) => url.searchParams.append(key, value));

	return url;
}

function RelativeTimeTillNow(props) {
	const now = new Date();
	const then = new Date(props.time);
	const seconds = (then - now) / 1000;

	const intl = new Intl.RelativeTimeFormat("en", { numeric: "always" });

	if (-seconds < 60) {
		return intl.format(Math.ceil(seconds), "second");
	}
	if (-seconds < 60 * 60) {
		return intl.format(Math.ceil(seconds / 60), "minute");
	}
	if (-seconds < 60 * 60 * 24) {
		return intl.format(Math.ceil(seconds / 60 / 60), "hour");
	}
	return intl.format(Math.ceil(seconds / 60 / 60 / 24), "day");
}
