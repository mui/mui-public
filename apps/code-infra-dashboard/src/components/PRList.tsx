import * as React from 'react';
import { Link as RouterLink } from 'react-router';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Divider from '@mui/material/Divider';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import GitPullRequestIcon from '@mui/icons-material/Commit';
import { styled } from '@mui/material/styles';
import { GitHubPRInfo } from '../hooks/useGitHubPR';
import ErrorDisplay from './ErrorDisplay';

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

interface PrRowProps {
  pr: GitHubPRInfo | null;
  owner: string;
  repo: string;
  loading?: boolean;
}

function PrRow({ pr, owner, repo, loading = false }: PrRowProps) {
  if (loading || !pr) {
    return (
      <StyledListItem
        sx={{
          py: 1.5,
          cursor: 'default',
          '&:hover': {
            backgroundColor: 'transparent',
            borderLeft: '2px solid transparent',
          },
        }}
      >
        <Box sx={{ mr: 1, color: 'text.secondary', display: 'flex' }}>
          <GitPullRequestIcon fontSize="small" />
        </Box>
        <ListItemText
          primary={
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Skeleton width={60} height={20} sx={{ mr: 1 }} />
              <Skeleton width={300} height={20} />
            </Box>
          }
          slotProps={{
            secondary: {
              component: 'div',
            },
          }}
          secondary={
            <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5, gap: 2 }}>
              <Skeleton width={80} height={20} />
              <Skeleton width={120} height={16} />
              <Skeleton width={100} height={16} />
            </Box>
          }
        />
      </StyledListItem>
    );
  }

  return (
    <StyledListItem
      // @ts-expect-error https://github.com/mui/material-ui/issues/29875
      component={RouterLink}
      to={`/repository/${owner}/${repo}/prs/${pr.number}`}
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
        slotProps={{
          secondary: {
            component: 'div',
          },
        }}
        secondary={
          <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5, gap: 2 }}>
            <Chip
              label={pr.base.ref}
              size="small"
              color="primary"
              variant="outlined"
              sx={{ fontSize: '0.7rem', height: 20 }}
            />
            <Typography variant="caption" color="text.secondary">
              SHA: <code>{pr.head.sha.substring(0, 7)}</code>
            </Typography>
          </Box>
        }
      />
    </StyledListItem>
  );
}

interface PRListProps {
  prs: GitHubPRInfo[];
  isLoading: boolean;
  isFetchingNextPage?: boolean;
  hasNextPage?: boolean;
  error: Error | null;
  owner: string;
  repo: string;
  onLoadMore?: () => void;
}

export default function PRList({
  prs,
  isLoading,
  isFetchingNextPage = false,
  hasNextPage = false,
  error,
  owner,
  repo,
  onLoadMore,
}: PRListProps) {
  const displayItems = isLoading
    ? Array.from({ length: 20 }, (_, index) => ({ id: `skeleton-${index}`, pr: null }))
    : prs.map((pr) => ({ id: pr.number, pr }));

  return (
    <Box>
      <Paper elevation={2} sx={{ overflow: 'hidden' }}>
        {error ? (
          <Box sx={{ p: 3 }}>
            <ErrorDisplay title="Error loading pull requests" error={error} />{' '}
          </Box>
        ) : null}

        {error ? null : (
          <React.Fragment>
            <List disablePadding>
              {displayItems.map((item, index) => (
                <React.Fragment key={item.id}>
                  {index > 0 && <Divider />}
                  <PrRow pr={item.pr} owner={owner} repo={repo} loading={isLoading} />
                </React.Fragment>
              ))}
            </List>

            {onLoadMore && (
              <Box sx={{ display: 'flex', justifyContent: 'center', m: 3 }}>
                <Button
                  variant="outlined"
                  onClick={onLoadMore}
                  disabled={isFetchingNextPage || !hasNextPage}
                  loading={isFetchingNextPage}
                >
                  Load More
                </Button>
              </Box>
            )}
          </React.Fragment>
        )}
      </Paper>
    </Box>
  );
}
