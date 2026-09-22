'use client';

import * as React from 'react';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import GitHubIcon from '@mui/icons-material/GitHub';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemText from '@mui/material/ListItemText';
import Skeleton from '@mui/material/Skeleton';
import Tooltip from '@mui/material/Tooltip';
import { useSession } from './SessionProvider';

export default function SignInButton() {
  const { session, isLoading, signIn, signOut } = useSession();
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);

  if (isLoading || !session) {
    return <Skeleton variant="rounded" width={88} height={30} />;
  }

  // Preview deploys have an origin GitHub can't redirect back to, so sign-in is
  // simply unavailable there rather than broken.
  if (!session.available) {
    return (
      <Tooltip title="GitHub sign-in is not configured for this deployment">
        <span>
          <Button disabled startIcon={<GitHubIcon />}>
            Sign in
          </Button>
        </span>
      </Tooltip>
    );
  }

  if (!session.signedIn) {
    return (
      <Tooltip title="Raises the GitHub API rate limit and unlocks private repositories">
        <Button startIcon={<GitHubIcon />} onClick={signIn}>
          Sign in
        </Button>
      </Tooltip>
    );
  }

  return (
    <React.Fragment>
      <Tooltip title={session.name ? `${session.name} (${session.login})` : session.login}>
        <IconButton onClick={(event) => setAnchorEl(event.currentTarget)}>
          <Avatar src={session.avatarUrl} alt={session.login} sx={{ width: 24, height: 24 }} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem
          onClick={async () => {
            setAnchorEl(null);
            await signOut();
          }}
        >
          <ListItemText>Sign out</ListItemText>
        </MenuItem>
      </Menu>
    </React.Fragment>
  );
}
