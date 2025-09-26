import * as React from 'react';
import { useParams } from 'react-router';
import Link from '@mui/material/Link';
import Heading from '../components/Heading';
import DailyBundleSizeChart from '../components/DailyBundleSizeChart';

export default function RepositoryCharts() {
  const params = useParams<{ owner: string; repo: string }>();
  if (!params.owner || !params.repo) {
    throw new Error('Missing required path parameters');
  }

  const owner = params.owner;
  const repo = params.repo;
  const fullRepo = `${owner}/${repo}`;

  return (
    <React.Fragment>
      <Heading level={2}>
        Bundle Size Charts for{' '}
        <Link
          href={`https://github.com/${owner}/${repo}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {owner}/{repo}
        </Link>
      </Heading>

      <DailyBundleSizeChart repo={fullRepo} />
    </React.Fragment>
  );
}
