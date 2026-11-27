'use client';

import * as React from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import { repositories } from '../constants';
import { signIn, useSession } from '../hooks/useSession';

interface PrivateRepositoryGateProps {
  repo: string;
  children: React.ReactNode;
}

/**
 * Renders a private repository's data only for signed-in visitors, whose requests carry their
 * token. Whether that token can read the repository is GitHub's call: without access, the data
 * requests fail with GitHub's 404.
 */
export default function PrivateRepositoryGate({ repo, children }: PrivateRepositoryGateProps) {
  const { session, isPending } = useSession();

  if (repositories.get(repo)?.isPublic !== false || session?.signedIn) {
    return children;
  }

  if (isPending) {
    return <Skeleton variant="rounded" height={48} />;
  }

  return (
    <Alert
      severity="info"
      action={
        session?.available ? (
          <Button color="inherit" size="small" onClick={signIn}>
            Sign in with GitHub
          </Button>
        ) : null
      }
    >
      This is a private repository.{' '}
      {session?.available
        ? 'Sign in to view its data.'
        : 'Its data is only shown to signed-in users.'}
    </Alert>
  );
}
