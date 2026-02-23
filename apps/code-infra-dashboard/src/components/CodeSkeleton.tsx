import * as React from 'react';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';

export default function CodeSkeleton() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Skeleton variant="text" sx={{ width: '42ch' }} />
      <Skeleton variant="text" sx={{ width: '39ch' }} />
      {'\u00A0'}
      <Skeleton variant="text" sx={{ width: '76ch' }} />
      <Skeleton variant="text" sx={{ width: '39ch', ml: '2ch' }} />
      <Skeleton variant="text" sx={{ width: '22ch', ml: '2ch' }} />
      <Skeleton variant="text" sx={{ width: '68ch', ml: '4ch' }} />
      <Skeleton variant="text" sx={{ width: '3ch', ml: '2ch' }} />
      <Skeleton variant="text" sx={{ width: '26ch', ml: '2ch' }} />
      <Skeleton variant="text" sx={{ width: '3ch' }} />
    </Box>
  );
}
