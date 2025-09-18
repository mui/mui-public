import * as React from 'react';
import { useParams } from 'react-router';
import Link from '@mui/material/Link';
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

  const { prs, isLoading, isFetchingNextPage, hasNextPage, error, fetchNextPage } = useGitHubPRs(
    fullRepo,
    20,
  );

  return (
    <React.Fragment>
      <Heading level={2}>
        Recent pull requests for{' '}
        <Link
          href={`https://github.com/${owner}/${repo}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {owner}/{repo}
        </Link>
      </Heading>

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
