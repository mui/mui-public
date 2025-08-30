import * as React from 'react';
import { useParams } from 'react-router';
import Box from '@mui/material/Box';
import Heading from '../components/Heading';
import PRList from '../components/PRList';
import DailyBundleSizeChart from '../components/DailyBundleSizeChart';
import { useGitHubPRs } from '../hooks/useGitHubPRs';

export default function RepositoryPRs() {
  const params = useParams<{ owner: string; repo: string }>();
  if (!params.owner || !params.repo) {
    throw new Error('Missing required path parameters');
  }

  const owner = params.owner;
  const repo = params.repo;
  const fullRepo = `${owner}/${repo}`;

  const { prs, isLoading, isFetchingNextPage, hasNextPage, error, fetchNextPage } = useGitHubPRs(
    fullRepo,
    5,
  );

  return (
    <React.Fragment>
      <Heading level={1}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          Bundle Size Comparisons for {owner}/{repo}
        </Box>
      </Heading>

      <DailyBundleSizeChart repo={fullRepo} />

      <Box sx={{ mt: 3, mb: 2 }}>
        <Heading level={2}>Pull Requests</Heading>
      </Box>

      <PRList
        prs={prs}
        isLoading={isLoading}
        isFetchingNextPage={isFetchingNextPage}
        hasNextPage={hasNextPage}
        error={error}
        owner={owner}
        repo={repo}
        onLoadMore={fetchNextPage}
      />
    </React.Fragment>
  );
}
