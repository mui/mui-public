'use client';

import * as React from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import type { SxProps, Theme } from '@mui/material/styles';

interface CopyButtonProps {
  text: string;
  /** Tooltip shown before copying. */
  title?: string;
  disabled?: boolean;
  sx?: SxProps<Theme>;
}

export default function CopyButton({
  text,
  title = 'Copy to clipboard',
  disabled,
  sx,
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Tooltip title={copied ? 'Copied!' : title}>
      {/* A disabled button fires no events, the wrapper keeps its tooltip working */}
      <Box component="span" sx={[{ display: 'inline-flex' }, ...(Array.isArray(sx) ? sx : [sx])]}>
        <IconButton
          size="small"
          onClick={handleCopy}
          disabled={disabled}
          color={copied ? 'success' : 'default'}
        >
          {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
        </IconButton>
      </Box>
    </Tooltip>
  );
}
