import * as React from 'react';
import NextLink from 'next/link';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import Box from '@mui/material/Box';
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
        {prNumber && (
          <React.Fragment>
            {' · '}
            <Link component={NextLink} href={`/repository/${owner}/${repoName}/prs/${prNumber}`}>
              PR overview
            </Link>
          </React.Fragment>
        )}
      </Typography>
    </Box>
  );
}
