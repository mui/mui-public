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
        mb: 2,
        '&:hover .anchor-link': {
          opacity: 0.7
        }
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
            opacity: 0,
            transition: 'opacity 0.2s ease',
            '&:hover': {
              opacity: 1
            }
          }}
        >
          <LinkIcon fontSize="small" />
        </IconButton>
      )}
    </Box>
  );
}
