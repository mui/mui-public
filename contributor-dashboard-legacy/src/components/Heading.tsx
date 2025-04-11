import * as React from 'react';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import IconButton from '@mui/material/IconButton';
import LinkIcon from '@mui/icons-material/Link';
import Box from '@mui/material/Box';

interface HeadingProps {
  id?: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children: React.ReactNode;
}

export default function Heading(props: HeadingProps): React.ReactElement {
  const { children, id, level } = props;

  return (
    <Box 
      sx={{ 
        display: 'flex', 
        alignItems: 'center',
        mb: 3,
        position: 'relative',
        '&:hover .anchor-link': {
          opacity: 0.6
        },
        '&::after': level === 1 ? {
          content: '""',
          position: 'absolute',
          bottom: -8,
          left: 0,
          width: '40px',
          height: '2px',
          bgcolor: 'primary.main',
          borderRadius: '1px'
        } : {}
      }}
    >
      <Typography id={id} variant={`h${level}`} component={`h${level}`}>
        {children}
      </Typography>
      {id !== undefined && (
        <IconButton
          aria-labelledby={id}
          id={`${id}-fragment-link`}
          component={Link}
          href={`#${id}`}
          size="small"
          className="anchor-link"
          sx={{ 
            ml: 1,
            opacity: 0.3,
            transition: 'opacity 0.2s ease',
            padding: '4px',
            color: 'primary.main',
            '&:hover': {
              opacity: 1,
              backgroundColor: 'rgba(255, 255, 255, 0.08)'
            }
          }}
        >
          <LinkIcon fontSize="small" sx={{ fontSize: '0.85rem' }} />
        </IconButton>
      )}
    </Box>
  );
}
