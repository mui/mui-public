import * as React from "react";
import ExpansionPanel from "@material-ui/core/ExpansionPanel";
import ExpansionPanelDetails from "@material-ui/core/ExpansionPanelDetails";
import ExpansionPanelSummary from "@material-ui/core/ExpansionPanelSummary";
import List from "@material-ui/core/List";
import ListItem from "@material-ui/core/ListItem";
import Link from "@material-ui/core/Link";
import Typography from "@material-ui/core/Typography";
import ExpandMoreIcon from "@material-ui/icons/ExpandMore";
import { useQuery } from "react-query";
import styled from "styled-components";
import ErrorBoundary from "../components/ErrorBoundary";

export default function Landing() {
  return (
    <React.Fragment>
      <Typography variant="h1">Maintainer Dashboard</Typography>
      <Typography variant="h2">CircleCI workflows</Typography>
      <CircleCIWorkflows />
    </React.Fragment>
  );
}

function CircleCIWorkflows() {
  const workflows = [
    { name: "typescript-next", label: "typescript@next" },
    { name: "pipeline", label: "main" },
    { name: "react-next", label: "react@next" }
  ];
  return (
    <React.SuspenseList revealOrder="forwards">
      {workflows.map(workflow => {
        return <CircleCIWorkflow key={workflow.name} workflow={workflow} />;
      })}
    </React.SuspenseList>
  );
}

function CircleCIWorkflow(props) {
  const { workflow } = props;

  return (
    <ExpansionPanel>
      <ExpansionPanelSummary
        aria-controls={`circleci-workflow-${workflow.name}-content`}
        id={`circleci-workflow-${workflow.name}-header`}
        expandIcon={<ExpandMoreIcon />}
      >
        <Typography>{workflow.label}</Typography>
      </ExpansionPanelSummary>
      <ExpansionPanelDetails>
        <React.Suspense fallback="loading">
          <ErrorBoundary fallback="failed fetching CircleCI builds">
            <CircleCIBuilds workflow={workflow} />
          </ErrorBoundary>
        </React.Suspense>
      </ExpansionPanelDetails>
    </ExpansionPanel>
  );
}

const CircleCIBuild = styled(ListItem)`
  display: inline-block;
`;

function CircleCIBuilds(props) {
  const { workflow } = props;

  const builds = useRecentBuilds({ workflowName: workflow.name });

  // recent builds first
  const sortedBuilds = builds.sort((a, b) => {
    return new Date(b.stop_time) - new Date(a.stop_time);
  });

  return (
    <List>
      {sortedBuilds.map(build => {
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
  const { workflowName } = filter;
  const { data: builds } = useQuery(
    "circle-ci-builds",
    fetchRecentCircleCIBuilds
  );
  React.useDebugValue(builds);

  return builds.filter(build => {
    return build.workflows.workflow_name === workflowName;
  });
}

async function fetchRecentCircleCIBuilds() {
  const url = getCircleCIApiUrl("project/github/mui-org/material-ui", {
    filter: "completed"
  });
  const response = await fetch(url);
  const builds = await response.json();

  return builds;
}

function getCircleCIApiUrl(endpoint, params) {
  const apiEndpoint = "https://circleci.com/api/v1.1/";
  const url = new URL(`${apiEndpoint}${endpoint}`);
  new URLSearchParams({
    ...params
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
    return intl.format(Math.ceil(seconds) / 60, "minute");
  }
  if (-seconds < 60 * 60 * 24) {
    return intl.format(Math.ceil(seconds / 60 / 60), "hour");
  }
  return intl.format(Math.ceil(seconds / 60 / 60 / 24), "day");
}
