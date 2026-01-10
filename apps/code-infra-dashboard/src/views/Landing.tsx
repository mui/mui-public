'use client';

import * as React from 'react';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid';
import Box from '@mui/material/Box';
import NextLink from 'next/link';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import GitHubIcon from '@mui/icons-material/GitHub';
import BuildIcon from '@mui/icons-material/Build';
import CompareIcon from '@mui/icons-material/Compare';
import AssessmentIcon from '@mui/icons-material/Assessment';
import Link from '@mui/material/Link';
import CardActionArea from '@mui/material/CardActionArea';
import Heading from '../components/Heading';
import { repositories } from '../constants';

interface Tool {
  name: string;
  description: string;
  icon: React.ReactNode;
  path: string;
}

const tools: Tool[] = [
  {
    name: 'KPIs Dashboard',
    description: 'Track key performance indicators across GitHub, Zendesk, CI, and more',
    icon: <AssessmentIcon />,
    path: '/kpis',
  },
  {
    name: 'NPM Package Stats',
    description: 'Analyze NPM package downloads, version breakdown, and historical trends',
    icon: <TrendingUpIcon />,
    path: '/npm-versions',
  },
  {
    name: 'Package Diff Tool',
    description: 'Compare two npm packages side-by-side to see file-level differences and changes',
    icon: <CompareIcon />,
    path: '/diff-package',
  },
];

export default function Landing() {
  return (
    <Box sx={{ mt: 4 }}>
      <Heading level={1}>MUI Repositories Overview</Heading>
      <Grid container spacing={3} sx={{ mt: 2 }}>
        {repositories.map((repo) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={`${repo.owner}/${repo.name}`}>
            <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ flexGrow: 1 }}>
                <Typography gutterBottom variant="h5" component="h2">
                  {repo.displayName}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {repo.description}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 1, display: 'block' }}
                >
                  {repo.owner}/{repo.name}
                </Typography>
              </CardContent>
              <CardActions>
                <Button
                  size="small"
                  component={NextLink}
                  href={`/repository/${repo.owner}/${repo.name}/prs`}
                >
                  Pull Requests
                </Button>
                <Button
                  size="small"
                  component={NextLink}
                  href={`/repository/${repo.owner}/${repo.name}/bundle-size`}
                  startIcon={<TrendingUpIcon />}
                >
                  Bundle Size
                </Button>
                <Button
                  size="small"
                  component={Link}
                  href={`https://github.com/${repo.owner}/${repo.name}`}
                  rel="noopener noreferrer"
                  startIcon={<GitHubIcon />}
                >
                  GitHub
                </Button>
                <Button
                  size="small"
                  component={Link}
                  href={`https://app.circleci.com/pipelines/github/${repo.owner}/${repo.name}`}
                  rel="noopener noreferrer"
                  startIcon={<BuildIcon />}
                >
                  CircleCI
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Heading level={1} sx={{ mt: 6 }}>
        Tools
      </Heading>
      <Grid container spacing={3} sx={{ mt: 2 }}>
        {tools.map((tool) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={tool.path}>
            <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <CardActionArea
                component={NextLink}
                href={tool.path}
                sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              >
                <CardContent sx={{ flexGrow: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    {tool.icon}
                    <Typography gutterBottom variant="h5" component="h2" sx={{ ml: 1, mb: 0 }}>
                      {tool.name}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {tool.description}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
