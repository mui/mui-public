import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import Button from '@mui/material/Button';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import GitHubPRReference from './GitHubPRReference';

interface ReportHeaderProps {
  repo: string;
  sha: string;
  baseSha: string | null;
  prNumber?: number;
  baseRef?: string;
}

export default function ReportHeader({ repo, sha, baseSha, prNumber, baseRef }: ReportHeaderProps) {
  const [owner, repoName] = repo.split('/');

  return (
    <React.Fragment>
      {prNumber && (
        <Box sx={{ mb: 2 }}>
          <Button
            component={NextLink}
            href={`/repository/${owner}/${repoName}/prs/${prNumber}`}
            startIcon={<ArrowBackIcon />}
            size="small"
          >
            Back to PR #{prNumber}
          </Button>
        </Box>
      )}

      <Box sx={{ mb: 2 }}>
        {prNumber && (
          <Typography variant="h6" component="h2" gutterBottom>
            <GitHubPRReference repo={repo} prNumber={prNumber} />
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary">
          Commit{' '}
          <Link
            href={`https://github.com/${repo}/commit/${sha}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {sha.substring(0, 7)}
          </Link>
          {baseSha && (
            <React.Fragment>
              {' — comparing against '}
              {baseRef && `${baseRef} (`}
              <Link
                href={`https://github.com/${repo}/commit/${baseSha}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {baseSha.substring(0, 7)}
              </Link>
              {baseRef && ')'}
            </React.Fragment>
          )}
          {!baseSha && ' — no baseline'}
        </Typography>
      </Box>
    </React.Fragment>
  );
}
