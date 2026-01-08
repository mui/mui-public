'use client';

import * as React from 'react';
import { useParams, usePathname } from 'next/navigation';
import NextLink from 'next/link';
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
  const pathname = usePathname();
  const target = `/repository/${params.owner}/${params.repo}${to}`;
  const isActive = pathname.startsWith(target);
  return (
    <Link
      component={NextLink}
      href={target}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        textDecoration: 'none',
        color: isActive ? 'primary.main' : 'text.secondary',
        fontWeight: isActive ? 600 : 400,
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

interface RepositoryLayoutProps {
  children: React.ReactNode;
}

export default function RepositoryLayout({ children }: RepositoryLayoutProps) {
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

      {children}
    </Box>
  );
}
