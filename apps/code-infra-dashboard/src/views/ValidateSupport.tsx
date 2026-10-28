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
import type { ValidateSupportParams, ValidateSupportResult } from '../lib/validateSupport';

function isValidateSupportResult(body: unknown): body is ValidateSupportResult {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  if (!('message' in body) || typeof body.message !== 'string') {
    return false;
  }
  return 'status' in body && (body.status === 'success' || body.status === 'error');
}

async function submitSupportKey(params: ValidateSupportParams): Promise<ValidateSupportResult> {
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
    body = null;
  }

  if (!isValidateSupportResult(body)) {
    throw new Error(`Unexpected response from the server (${response.status}).`);
  }

  return body;
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

  // A rejected request and an "invalid key" response are both just a message to show.
  const result: ValidateSupportResult | undefined = mutation.isError
    ? { status: 'error', message: mutation.error.message }
    : mutation.data;

  return (
    <Box sx={{ mt: 4, mb: 10, maxWidth: 640 }}>
      <Heading level={1}>Support key validator</Heading>

      {hasIssue ? (
        <React.Fragment>
          <Typography variant="body1">
            Please provide your support key below to validate your support plan with issue{' '}
            <Link href={issueUrl}>
              mui/{params.repo}#{params.issueId}
            </Link>
            .
          </Typography>

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
        </React.Fragment>
      ) : (
        <Alert severity="warning">GitHub issue not provided!</Alert>
      )}

      {result ? (
        <Alert severity={result.status === 'success' ? 'success' : 'error'} sx={{ mt: 4 }}>
          {result.message}
        </Alert>
      ) : null}
    </Box>
  );
}
