'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from '@mui/material/Link';
import Alert from '@mui/material/Alert';
import Heading from '../components/Heading';
import DailyBundleSizeChart from '../components/DailyBundleSizeChart';
import { findRepository } from '../constants';

export default function RepositoryCharts() {
  const params = useParams<{ owner: string; repo: string }>();
  if (!params.owner || !params.repo) {
    throw new Error('Missing required path parameters');
  }

  const owner = params.owner;
  const repo = params.repo;
  const fullRepo = `${owner}/${repo}`;
  const repoConfig = findRepository(owner, repo);

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

      {repoConfig?.isPublic === false ? (
        <Alert severity="info">
          This is a private repository. Bundle size data is not available through the public GitHub
          API.
        </Alert>
      ) : (
        <DailyBundleSizeChart repo={fullRepo} />
      )}
    </React.Fragment>
  );
}
