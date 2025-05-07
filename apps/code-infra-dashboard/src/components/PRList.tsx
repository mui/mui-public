import * as React from 'react';
import { Link as RouterLink } from 'react-router';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Divider from '@mui/material/Divider';
import Chip from '@mui/material/Chip';
import GitPullRequestIcon from '@mui/icons-material/Commit';
import BarChartIcon from '@mui/icons-material/BarChart';
import { styled } from '@mui/material/styles';
import { GitHubPRInfo } from '../hooks/useGitHubPR';

const StyledListItem = styled(ListItem)(({ theme }) => ({
  borderLeft: '2px solid transparent',
  cursor: 'pointer',
  '&:hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderLeft: `2px solid ${theme.palette.secondary.main}`,
  },
  transition: 'background-color 0.2s, border-left 0.2s',
}));

const PRNumber = styled(Typography)(({ theme }) => ({
  color: theme.palette.text.secondary,
  fontWeight: 500,
  marginRight: theme.spacing(1),
}));

interface PRListProps {
  prs: GitHubPRInfo[];
  isLoading: boolean;
  error: Error | null;
  owner: string;
  repo: string;
}

export default function PRList({ prs, isLoading, error, owner, repo }: PRListProps) {
  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
        <CircularProgress size={16} />
        <Typography>Loading pull requests...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2, color: 'error.main' }}>
        <Typography variant="subtitle1" gutterBottom>
          Error loading pull requests
        </Typography>
        <Typography variant="body2">{error.message || 'Unknown error occurred'}</Typography>
      </Box>
    );
  }

  if (prs.length === 0) {
    return (
      <Box sx={{ p: 2, color: 'text.secondary' }}>
        <Typography>No pull requests found.</Typography>
      </Box>
    );
  }

  return (
    <Paper elevation={2} sx={{ overflow: 'hidden' }}>
      <List disablePadding>
        {prs.map((pr, index) => (
          <React.Fragment key={pr.number}>
            {index > 0 && <Divider />}
            <StyledListItem
              // @ts-expect-error https://github.com/mui/material-ui/issues/29875
              component={RouterLink}
              to={`/size-comparison/${owner}/${repo}/${pr.number}`}
              sx={{
                py: 1.5,
                color: 'text.primary',
                textDecoration: 'none',
                '&:hover': {
                  textDecoration: 'none',
                },
              }}
            >
              <Box sx={{ mr: 1, color: 'text.secondary', display: 'flex' }}>
                <GitPullRequestIcon fontSize="small" />
              </Box>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <PRNumber variant="body2">#{pr.number}</PRNumber>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {pr.title}
                    </Typography>
                  </Box>
                }
                secondary={
                  <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5 }}>
                    <Chip
                      label={pr.base.ref}
                      size="small"
                      color="primary"
                      variant="outlined"
                      sx={{ fontSize: '0.7rem', height: 20, mr: 1 }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      SHA: <code>{pr.head.sha.substring(0, 7)}</code>
                    </Typography>
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        ml: 2,
                        color: 'secondary.main',
                      }}
                    >
                      <BarChartIcon sx={{ mr: 0.5, fontSize: '0.9rem' }} />
                      <Typography variant="caption">View Bundle Size</Typography>
                    </Box>
                  </Box>
                }
              />
            </StyledListItem>
          </React.Fragment>
        ))}
      </List>
    </Paper>
  );
}
