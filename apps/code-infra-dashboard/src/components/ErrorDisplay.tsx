'use client';

import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { signIn, useSession } from '../hooks/useSession';

interface ErrorDisplayProps {
  title: string;
  error?: Error | string | null;
}

function isNotFound(error: ErrorDisplayProps['error']): boolean {
  return error instanceof Error && 'status' in error && error.status === 404;
}

export default function ErrorDisplay({ title, error }: ErrorDisplayProps) {
  const { session } = useSession();
  const errorMessage = error instanceof Error ? error.message : error;
  // GitHub answers 404 for a private repository the visitor can't read, same as for a missing one.
  const suggestSignIn = isNotFound(error) && session?.available && !session.signedIn;

  return (
    <Box sx={{ color: 'error.main' }}>
      <Typography variant="subtitle1" gutterBottom>
        {title}
      </Typography>
      <Typography variant="body2">{errorMessage || 'Unknown error occurred'}</Typography>
      {suggestSignIn ? (
        <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            If this is a private repository, sign in to view it.
          </Typography>
          <Button size="small" onClick={signIn}>
            Sign in with GitHub
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
