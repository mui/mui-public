'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import GitHubIcon from '@mui/icons-material/GitHub';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import Skeleton from '@mui/material/Skeleton';
import Heading from '../components/Heading';
import ErrorDisplay from '../components/ErrorDisplay';
import { useGitHubPR } from '../hooks/useGitHubPR';
import { useCompareCommits } from '../hooks/useCompareCommits';
import { repositories } from '../constants';
import { getPkgPrNewUrl } from '../utils/pkgPrNew';

interface InfoChipProps {
  label: string;
  value: string | React.ReactNode;
  color?: 'primary' | 'secondary' | 'info';
  loading?: boolean;
}

function InfoChip({ label, value, color = 'primary', loading = false }: InfoChipProps) {
  return (
    <Chip
      label={
        <React.Fragment>
          {label}:{' '}
          {loading ? (
            <Skeleton variant="text" sx={{ display: 'inline-block' }} width={60} />
          ) : (
            value
          )}
        </React.Fragment>
      }
      size="small"
      color={color}
      variant="outlined"
    />
  );
}

export default function RepositoryPR() {
  const params = useParams<{ owner: string; repo: string; prNumber: string }>();
  if (!params.owner || !params.repo || !params.prNumber) {
    throw new Error('Missing required path parameters');
  }

  const owner = params.owner;
  const repo = params.repo;
  const prNumber = parseInt(params.prNumber, 10);
  const fullRepo = `${owner}/${repo}`;

  const { prInfo, isLoading: isPrLoading, error: prError } = useGitHubPR(fullRepo, prNumber);
  const {
    compareInfo,
    isLoading: isMergeBaseLoading,
    error: mergeBaseError,
  } = useCompareCommits(fullRepo, prInfo?.base.ref, prInfo?.head.sha);

  // Find repository packages
  const repository = repositories.find((r) => r.owner === owner && r.name === repo);
  const packages = repository?.packages || [];
  const mergeBase = compareInfo?.mergeBase || null;

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Heading level={2}>
          #{prNumber}:{' '}
          {prInfo?.title || (
            <Skeleton variant="text" sx={{ display: 'inline-block' }} width={100} />
          )}
        </Heading>
        {mergeBaseError ? (
          <ErrorDisplay title="Error loading merge base information" error={mergeBaseError} />
        ) : null}
        {prError ? <ErrorDisplay title="Error loading PR information" error={prError} /> : null}

        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          <InfoChip label="Base" value={prInfo?.base.ref} color="primary" loading={isPrLoading} />
          <InfoChip
            label="Head"
            value={prInfo?.head.sha.substring(0, 7)}
            color="secondary"
            loading={isPrLoading}
          />
          <InfoChip
            label="Merge base"
            value={mergeBase?.substring(0, 7) || 'Unknown'}
            color="info"
            loading={isMergeBaseLoading}
          />
        </Box>

        <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
          <Button
            component={Link}
            href={prInfo?.html_url}
            disabled={!prInfo}
            target="_blank"
            rel="noopener noreferrer"
            startIcon={<GitHubIcon />}
            size="small"
          >
            View on GitHub
          </Button>
          <Button
            component={NextLink}
            href={`/size-comparison/${owner}/${repo}/diff?prNumber=${prNumber}`}
            startIcon={<TrendingUpIcon />}
            size="small"
          >
            Bundle Size Comparison
          </Button>
        </Box>
      </Box>

      {packages.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Heading level={3}>Packages</Heading>
          <Grid container spacing={3}>
            {packages.map((packageName) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={packageName}>
                <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <CardContent sx={{ flexGrow: 1 }}>
                    <Typography gutterBottom variant="h5" component="h4">
                      {packageName}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      View package on NPM
                    </Typography>
                  </CardContent>
                  <CardActions>
                    <Button
                      size="small"
                      component={Link}
                      href={`https://www.npmjs.com/package/${packageName}`}
                      rel="noopener noreferrer"
                    >
                      NPM
                    </Button>
                    <Button
                      size="small"
                      component={NextLink}
                      href={`/npm-versions?package=${packageName}`}
                    >
                      Versions
                    </Button>
                    <Button
                      size="small"
                      component={Link}
                      href={getPkgPrNewUrl(owner, repo, packageName, prInfo?.head.sha ?? '')}
                      disabled={!prInfo}
                      rel="noopener noreferrer"
                    >
                      pkg.pr.new
                    </Button>
                    <Button
                      size="small"
                      component={NextLink}
                      href={`/diff-package?package1=${getPkgPrNewUrl(owner, repo, packageName, mergeBase ?? '')}&package2=${getPkgPrNewUrl(owner, repo, packageName, prInfo?.head.sha ?? '')}`}
                      disabled={!mergeBase || !prInfo}
                    >
                      Diff
                    </Button>
                    <Button
                      size="small"
                      component={NextLink}
                      href={`/inspect-package?package=${getPkgPrNewUrl(owner, repo, packageName, prInfo?.head.sha ?? '')}`}
                      disabled={!prInfo}
                    >
                      Inspect
                    </Button>
                  </CardActions>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
    </Box>
  );
}
