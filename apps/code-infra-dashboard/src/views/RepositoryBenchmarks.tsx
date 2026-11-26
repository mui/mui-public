'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from '@mui/material/Link';
import Heading from '../components/Heading';
import DailyBenchmarkChart from '../components/DailyBenchmarkChart';
import BenchmarkRunHistory from '../components/BenchmarkRunHistory';
import PrivateRepositoryGate from '../components/PrivateRepositoryGate';

export default function RepositoryBenchmarks() {
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
        Benchmark Charts for{' '}
        <Link href={`https://github.com/${owner}/${repo}`} target="_blank">
          {owner}/{repo}
        </Link>
      </Heading>

      <PrivateRepositoryGate repo={fullRepo}>
        <DailyBenchmarkChart repo={fullRepo} />
        <BenchmarkRunHistory repo={fullRepo} />
      </PrivateRepositoryGate>
    </React.Fragment>
  );
}
