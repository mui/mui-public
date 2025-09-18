import * as React from 'react';
import { Outlet, useParams, Link as RouterLink, useMatch } from 'react-router';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import Heading from '../components/Heading';

interface NavLinkProps {
  to: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

function NavLink({ to, icon, children }: NavLinkProps) {
  const params = useParams<{ owner: string; repo: string }>();
  const target = `/repository/${params.owner}/${params.repo}${to}`;
  const match = useMatch(`${target}/*`);
  return (
    <Link
      component={RouterLink}
      to={target}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        textDecoration: 'none',
        color: match ? 'primary.main' : 'text.secondary',
        fontWeight: match ? 600 : 400,
        '&:hover': {
          color: 'primary.main',
          textDecoration: 'none',
        },
      }}
    >
      {icon}
      {children}
    </Link>
  );
}

export default function RepositoryLayout() {
  const params = useParams<{ owner: string; repo: string }>();

  if (!params.owner || !params.repo) {
    throw new Error('Missing required path parameters');
  }

  const owner = params.owner;
  const repo = params.repo;

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 2,
          }}
        >
          <Heading level={1}>
            {owner}/{repo}
          </Heading>

          <Box sx={{ display: 'flex', gap: 3 }}>
            <NavLink to={`/prs`}>Pull Requests</NavLink>
            <NavLink to={`/bundle-size`} icon={<TrendingUpIcon fontSize="small" />}>
              Bundle Size History
            </NavLink>
          </Box>
        </Box>
      </Box>

      <Outlet />
    </Box>
  );
}
