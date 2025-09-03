import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface ErrorDisplayProps {
  title: string;
  error?: Error | string | null;
}

export default function ErrorDisplay({ title, error }: ErrorDisplayProps) {
  const errorMessage = error instanceof Error ? error.message : error;

  return (
    <Box sx={{ color: 'error.main' }}>
      <Typography variant="subtitle1" gutterBottom>
        {title}
      </Typography>
      <Typography variant="body2">{errorMessage || 'Unknown error occurred'}</Typography>
    </Box>
  );
}