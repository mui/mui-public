import * as React from 'react';
import { useParams } from 'react-router';
import Box from '@mui/material/Box';
import Heading from '../components/Heading';
import PRList from '../components/PRList';
import { useGitHubPRs } from '../hooks/useGitHubPRs';

export default function RepositoryPRs() {
  const params = useParams<{ owner: string; repo: string }>();
  if (!params.owner || !params.repo) {
    throw new Error('Missing required path parameters');
  }

  const owner = params.owner;
  const repo = params.repo;
  const fullRepo = `${owner}/${repo}`;

  const { prs, isLoading, error } = useGitHubPRs(fullRepo, 10);

  return (
    <React.Fragment>
      <Heading level={1}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          Bundle Size Comparisons for {owner}/{repo}
        </Box>
      </Heading>

      <PRList prs={prs} isLoading={isLoading} error={error} owner={owner} repo={repo} />
    </React.Fragment>
  );
}
