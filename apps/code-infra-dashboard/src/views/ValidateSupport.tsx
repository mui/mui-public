'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Heading from '../components/Heading';
import { useSearchParamsState, CODEC_NUMBER } from '../hooks/useSearchParamsState';

interface ValidateSupportResult {
  status: 'success' | 'error';
  message: string;
}

interface ValidateSupportRequest {
  repo: string;
  issueId: number;
  supportKey: string;
}

async function submitSupportKey(params: ValidateSupportRequest): Promise<ValidateSupportResult> {
  const response = await fetch('/api/validate-support', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  // Every failure the endpoint knows about comes back as a `{ status, message }` body,
  // so the payload is worth reading even when the status code is not a 2xx.
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Unexpected response from the server (${response.status}).`);
  }

  if (
    typeof body === 'object' &&
    body !== null &&
    'message' in body &&
    typeof body.message === 'string'
  ) {
    const isSuccess = 'status' in body && body.status === 'success';
    return { status: isSuccess ? 'success' : 'error', message: body.message };
  }

  throw new Error(`Unexpected response from the server (${response.status}).`);
}

export default function ValidateSupport() {
  const [params] = useSearchParamsState({
    repo: { defaultValue: '' },
    issueId: { defaultValue: 0, ...CODEC_NUMBER },
  });

  const [supportKey, setSupportKey] = React.useState('');

  const mutation = useMutation({
    mutationFn: submitSupportKey,
  });

  const hasIssue = Boolean(params.repo) && Boolean(params.issueId);
  const issueUrl = `https://github.com/mui/${params.repo}/issues/${params.issueId}`;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    mutation.mutate({ repo: params.repo, issueId: params.issueId, supportKey });
  };

  return (
    <Box sx={{ mt: 4, mb: 10, maxWidth: 640 }}>
      <Heading level={1}>Support key validator</Heading>

      {hasIssue ? (
        <Typography variant="body1">
          Please provide your support key below to validate your support plan with issue{' '}
          <Link href={issueUrl}>
            mui/{params.repo}#{params.issueId}
          </Link>
          .
        </Typography>
      ) : (
        <Alert severity="warning">GitHub issue not provided!</Alert>
      )}

      {hasIssue ? (
        <Box component="form" onSubmit={handleSubmit} sx={{ mt: 4 }}>
          <TextField
            label="Support key"
            name="supportKey"
            value={supportKey}
            onChange={(event) => setSupportKey(event.target.value)}
            variant="outlined"
            sx={{ width: 350, display: 'block' }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={!supportKey || mutation.isPending}
            sx={{ mt: 3 }}
          >
            {mutation.isPending ? 'Validating…' : 'Validate'}
          </Button>
        </Box>
      ) : null}

      {mutation.isError ? (
        <Alert severity="error" sx={{ mt: 4 }}>
          {mutation.error.message}
        </Alert>
      ) : null}

      {mutation.isSuccess ? (
        <Alert severity={mutation.data.status === 'success' ? 'success' : 'error'} sx={{ mt: 4 }}>
          {mutation.data.message}
        </Alert>
      ) : null}
    </Box>
  );
}
