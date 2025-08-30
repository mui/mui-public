import * as React from 'react';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid';
import Box from '@mui/material/Box';
import { Link as RouterLink } from 'react-router';
import Heading from '../components/Heading';

interface Repository {
  owner: string;
  name: string;
  displayName: string;
  description: string;
}

const repositories: Repository[] = [
  {
    owner: 'mui',
    name: 'material-ui',
    displayName: 'MUI Core',
    description: "React components implementing Google's Material Design",
  },
  {
    owner: 'mui',
    name: 'base-ui',
    displayName: 'MUI Base',
    description: 'Unstyled React components and low-level hooks',
  },
  {
    owner: 'mui',
    name: 'mui-x',
    displayName: 'MUI X',
    description: 'Advanced components for complex use cases',
  },
  {
    owner: 'mui',
    name: 'mui-public',
    displayName: 'MUI Public',
    description: 'Public monorepo with shared infrastructure and tooling',
  },
];

export default function Landing() {
  return (
    <Box>
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
                  component={RouterLink}
                  to={`/size-comparison/${repo.owner}/${repo.name}`}
                >
                  View Size Comparison
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
