'use client';

import * as React from 'react';
import CardActionArea from '@mui/material/CardActionArea';
import NextLink from 'next/link';

interface LinkCardActionAreaProps {
  href: string;
  children: React.ReactNode;
}

export default function LinkCardActionArea({
  href,
  children,
}: LinkCardActionAreaProps): React.ReactElement {
  return (
    <CardActionArea
      component={NextLink}
      href={href}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
      }}
    >
      {children}
    </CardActionArea>
  );
}
