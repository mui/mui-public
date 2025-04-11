/* eslint-disable no-console */
import * as React from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { usePaginatedQuery } from 'react-query';
import styled from '@emotion/styled';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HelpIcon from '@mui/icons-material/Help';
import { green, red } from '@mui/material/colors';
import ErrorBoundary from '../components/ErrorBoundary';
import Heading from '../components/Heading';

interface PipelineStatusIconProps {
  className?: string;
  size?: 'small' | 'middle';
  status?: string;
  [key: string]: any;
}

function UnstyledPipelineStatusIcon(props: PipelineStatusIconProps) {
  const { className, size, status, ...other } = props;
  switch (status) {
    case undefined:
      return <HelpIcon aria-label="unknown" className={className} {...other} />;
    case 'success': // CircleCI
    case 'succeeded': // Azure
      return <CheckCircleIcon aria-label="success" className={className} {...other} />;
    case 'failed': // CircleCI, Azure
      return <ErrorIcon aria-label="failed" className={className} {...other} />;
    default:
      throw new Error(`Unknown pipeline status '${status}'.`);
  }
}

const PipelineStatusIcon = styled(UnstyledPipelineStatusIcon)`
  color: ${({ status }) => {
    if (status === 'success' || status === 'succeeded') {
      return green[300];
    }
    if (status === 'failed') {
      return red[300];
    }
    return 'inherit';
  }};
  font-size: ${({ size }) => (size === 'middle' ? '1.4em' : '1em')};
  margin: 0 8px;
  vertical-align: sub;
`;

interface PipelineStatusUnstyledProps {
  children: React.ReactNode;
  size?: 'small' | 'middle';
  status?: string;
  [key: string]: any;
}

function PipelineStatusUnstyled(props: PipelineStatusUnstyledProps) {
  const { children, size = 'middle', status, ...other } = props;

  return (
    <Typography variant={size === 'middle' ? 'body1' : 'body2'} {...other}>
      <PipelineStatusIcon size={size} status={status} />
      <span>{children}</span>
    </Typography>
  );
}

const PipelineStatus = styled(PipelineStatusUnstyled)`
  align-items: center;
  display: flex;
`;

export default function Landing() {
  return (
    <div>
      <Heading level={1}>Maintainer Dashboard</Heading>
      <Heading level={2} id="circle-ci-workflows">
        CircleCI workflows
      </Heading>
      <CircleCIWorkflows />
      <Heading level={2} id="webpagetests">
        Webpagetests
      </Heading>
    </div>
  );
}

function CircleCIWorkflows() {
  const workflows = [
    { name: 'pipeline', label: 'material-ui@master', branchName: 'master' },
    { name: 'pipeline', label: 'material-ui@next', branchName: 'next' },
    { name: 'typescript-next', label: 'typescript@next' },
    { name: 'react-next', label: 'react@next' },
    { name: 'timezone-tests', label: 'experimental-timezones' },
  ];
  return (
    <div>
      {workflows.map((workflow) => {
        return (
          <div key={`${workflow.name}${workflow.branchName}`}>
            <ErrorBoundary fallback={<p>Failed fetching CircleCI builds for {workflow.name}</p>}>
              <CircleCIWorkflow workflow={workflow} />
            </ErrorBoundary>
          </div>
        );
      })}
    </div>
  );
}

interface WorkflowProps {
  name: string;
  label: string;
  branchName?: string;
}

interface CircleCIWorkflowProps {
  workflow: WorkflowProps;
}

interface CircleCIBuild {
  build_num: number;
  build_url: string;
  status?: string;
  branch: string;
  stop_time: string;
  workflows: {
    workflow_name: string;
    job_name: string;
  };
}

function CircleCIWorkflow(props: CircleCIWorkflowProps) {
  const { workflow } = props;

  const builds = useRecentBuilds({
    workflowName: workflow.name,
    branchName: workflow.branchName,
  });

  // recent builds first
  const sortedBuilds = builds.sort((a, b) => {
    return new Date(b.stop_time).getTime() - new Date(a.stop_time).getTime();
  });
  const [lastBuild] = sortedBuilds;

  return (
    <Accordion>
      <AccordionSummary
        aria-controls={`circleci-workflow-${workflow.name}-content`}
        id={`circleci-workflow-${workflow.name}-header`}
        expandIcon={<ExpandMoreIcon />}
      >
        <PipelineStatus status={lastBuild?.status}>{workflow.label}</PipelineStatus>
      </AccordionSummary>
      <AccordionDetails>
        <CircleCIBuilds builds={sortedBuilds} />
      </AccordionDetails>
    </Accordion>
  );
}

const CircleCIBuildListItem = styled(ListItem)`
  display: inline-block;
  padding-top: 0;
  padding-bottom: 0;
`;

interface CircleCIBuildsProps {
  builds: CircleCIBuild[];
}

function CircleCIBuilds(props: CircleCIBuildsProps) {
  const { builds } = props;

  return (
    <List component="ol">
      {builds.map((build) => {
        return (
          <CircleCIBuildListItem key={build.build_num}>
            <PipelineStatus size="small" status={build.status}>
              <Link href={build.build_url}>
                {build.workflows.job_name}@{build.branch}
              </Link>
              {' finished '}
              <RelativeTimeTillNow time={build.stop_time} />
            </PipelineStatus>
          </CircleCIBuildListItem>
        );
      })}
    </List>
  );
}

interface BuildFilter {
  workflowName: string;
  branchName?: string;
}

function useRecentBuilds(filter: BuildFilter): CircleCIBuild[] {
  const { branchName, workflowName } = filter;
  const [page, setPage] = React.useState(0);
  const { resolvedData: builds = [] } = usePaginatedQuery<CircleCIBuild[]>(
    ['circle-ci-builds', page],
    fetchRecentCircleCIBuilds,
    {
      getFetchMore: (lastGroup, allGroups) => {
        return allGroups.length;
      },
    },
  );
  React.useDebugValue(builds);

  console.log('builds', builds);

  const filteredBuilds = React.useMemo(() => {
    return builds.filter((build) => {
      return (
        build.workflows.workflow_name === workflowName &&
        (branchName === undefined || build.branch === branchName)
      );
    });
  }, [branchName, builds, workflowName]);

  // Fetch as long as we didn't find a build but stop after X pages.
  if (filteredBuilds.length === 0 && page < 9) {
    setPage(page + 1);
  }

  return React.useMemo(() => filteredBuilds.slice(0, 20), [filteredBuilds]);
}

async function fetchRecentCircleCIBuilds(key: string, cursor = 0): Promise<CircleCIBuild[]> {
  const url = getCircleCIApiUrl('project/github/mui/material-ui', {
    filter: 'completed',
    limit: 100,
    offset: 100 * cursor,
  });
  const response = await fetch(url);
  const builds = await response.json();

  return builds;
}

interface CircleCIParams {
  [key: string]: string | number;
}

function getCircleCIApiUrl(endpoint: string, params: CircleCIParams): URL {
  const apiEndpoint = 'https://circleci.com/api/v1.1/';
  const url = new URL(`${apiEndpoint}${endpoint}`);
  new URLSearchParams({
    ...(params as Record<string, string>),
  }).forEach((value, key) => url.searchParams.append(key, value));

  return url;
}

interface RelativeTimeProps {
  time: string;
}

function RelativeTimeTillNow({ time }: RelativeTimeProps): React.ReactElement {
  const [relativeTime, setRelativeTime] = React.useState<string>('');

  React.useEffect(() => {
    const then = new Date(time);
    if (Number.isNaN(then.getTime())) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('Invalid Date given with %s', time);
      }
      setRelativeTime('Unknown');
      return;
    }

    const now = new Date();
    const seconds = (then.getTime() - now.getTime()) / 1000;
    const intl = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

    let result: string;
    if (-seconds < 60) {
      result = intl.format(Math.ceil(seconds), 'second');
    } else if (-seconds < 60 * 60) {
      result = intl.format(Math.ceil(seconds / 60), 'minute');
    } else if (-seconds < 60 * 60 * 24) {
      result = intl.format(Math.ceil(seconds / 60 / 60), 'hour');
    } else {
      result = intl.format(Math.ceil(seconds / 60 / 60 / 24), 'day');
    }

    setRelativeTime(result);
  }, [time]);

  return <React.Fragment>{relativeTime}</React.Fragment>;
}
