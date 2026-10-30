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
import { signIn, signOut, useSession } from '../../hooks/useSession';

export default function SignInButton() {
  const { session, isPending } = useSession();
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const [signOutFailed, setSignOutFailed] = React.useState(false);

  if (isPending) {
    return <Skeleton variant="rounded" width={88} height={30} />;
  }

  // Without a session response there's no telling whether sign-in would work.
  if (!session) {
    return null;
  }

  // Preview deploys have an origin GitHub can't redirect back to, so sign-in is
  // unavailable there rather than broken.
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
      <Tooltip title="Raises the GitHub API rate limit from 60 to 5,000 requests per hour">
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
            setSignOutFailed(false);
            try {
              await signOut();
            } catch {
              setSignOutFailed(true);
            }
          }}
        >
          <ListItemText
            primary="Sign out"
            secondary={signOutFailed ? "That didn't work. Try again." : undefined}
          />
        </MenuItem>
      </Menu>
    </React.Fragment>
  );
}
