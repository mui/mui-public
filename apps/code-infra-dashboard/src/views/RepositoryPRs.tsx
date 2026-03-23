'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from '@mui/material/Link';
import Heading from '../components/Heading';
import PRList from '../components/PRList';

export default function RepositoryPRs() {
  const params = useParams<{ owner: string; repo: string }>();
  if (!params.owner || !params.repo) {
    throw new Error('Missing required path parameters');
  }

  const owner = params.owner;
  const repo = params.repo;

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

      <PRList owner={owner} repo={repo} />
    </React.Fragment>
  );
}
