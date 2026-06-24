'use client';

import * as React from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { DataGridPremium } from '@mui/x-data-grid-premium';
import type { GridColDef } from '@mui/x-data-grid-premium';
import { useQuery } from '@tanstack/react-query';
import Heading from '../components/Heading';
import ErrorDisplay from '../components/ErrorDisplay';

interface AboutPerson {
  name: string;
  title: string;
  about: string | null;
  location: string;
  locationCountry: string | null;
  github: string | null;
  twitter: string | null;
}

const COLUMNS: GridColDef<AboutPerson>[] = [
  { field: 'name', headerName: 'Name', width: 175 },
  { field: 'title', headerName: 'Title', width: 300 },
  { field: 'about', headerName: 'About', flex: 1, minWidth: 200 },
  { field: 'location', headerName: 'Location', width: 220 },
  {
    field: 'github',
    headerName: 'GitHub',
    width: 160,
    renderCell: (params) =>
      params.value ? (
        <Link href={`https://github.com/${params.value}`} target="_blank" underline="hover">
          {params.value}
        </Link>
      ) : null,
  },
  {
    field: 'twitter',
    headerName: 'Twitter',
    width: 160,
    renderCell: (params) =>
      params.value ? (
        <Link href={`https://x.com/${params.value}`} target="_blank" underline="hover">
          {params.value}
        </Link>
      ) : null,
  },
];

function useMuiAbout() {
  const { data, isLoading, error } = useQuery<{ people: AboutPerson[] }>({
    queryKey: ['mui-about'],
    queryFn: () => fetch('/api/mui-about').then((res) => res.json()),
    staleTime: 10 * 60 * 1000,
    retry: 0,
  });

  return {
    rows: data?.people ?? [],
    isLoading,
    error: error as Error | null,
  };
}

export default function MuiAbout() {
  const { rows, isLoading, error } = useMuiAbout();

  return (
    <Box
      sx={{
        mt: 4,
        height: 'calc(100dvh - 120px)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <Heading level={1}>mui.com/about</Heading>
      <Typography sx={{ mb: 1 }}>
        See <Link href="/api/mui-about">/api/mui-about</Link> for the API source.
      </Typography>
      {error ? (
        <ErrorDisplay title="Failed to load team data" error={error} />
      ) : (
        <DataGridPremium
          rows={rows}
          columns={COLUMNS}
          loading={isLoading}
          density="compact"
          getRowId={(row) => row.name}
          disableRowSelectionOnClick
          sx={{
            flex: 1,
            minHeight: 0,
            maxHeight: '100vh',
          }}
        />
      )}
    </Box>
  );
}
