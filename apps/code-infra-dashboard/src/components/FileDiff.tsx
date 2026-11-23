import * as React from 'react';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import CodeSkeleton from './CodeSkeleton';
import { escapeHtmlId } from '../utils/dom';
import type { DiffBlock } from '../lib/packageDiff/computePackageDiff';

interface FileDiffProps {
  fileName: string;
  blocks: DiffBlock[];
  /** Set when the file couldn't be formatted and the diff shows its raw contents. */
  formatError?: string;
  wrapLines?: boolean;
  loading?: boolean;
}

const FileDiff = React.memo(function FileDiff({
  fileName,
  blocks,
  formatError,
  wrapLines = false,
  loading,
}: FileDiffProps) {
  const fileId = `file-${escapeHtmlId(fileName)}`;

  return (
    <Paper sx={{ overflow: 'hidden' }}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }} id={fileId}>
        {loading ? (
          <Skeleton width="40%" />
        ) : (
          <Link
            variant="subtitle2"
            color="text.secondary"
            href={`#${fileId}`}
            sx={{ fontFamily: 'monospace' }}
          >
            {fileName}
          </Link>
        )}
        {formatError ? (
          <Typography
            variant="caption"
            color="warning.main"
            title={formatError}
            sx={{ display: 'block' }}
          >
            Couldn&apos;t format this file, showing the raw contents
          </Typography>
        ) : null}
      </Box>
      <Box
        sx={(theme) => ({
          code: {
            minWidth: '100%',
            width: 'fit-content',
            display: 'block',
          },
          '& .diff-added': {
            backgroundColor: '#d4edda',
            color: '#155724',
            display: 'block',
            ...theme.applyStyles('dark', {
              backgroundColor: '#1e3a20',
              color: '#a3d9a5',
            }),
          },
          '& .diff-removed': {
            backgroundColor: '#f8d7da',
            color: '#721c24',
            display: 'block',
            ...theme.applyStyles('dark', {
              backgroundColor: '#3a1e1e',
              color: '#f1a1a1',
            }),
          },
          '& .diff-hunk': {
            color: theme.vars.palette.primary.main,
            opacity: 0.8,
            fontWeight: 600,
            display: 'block',
          },
          '& .diff-preamble': {
            color: theme.vars.palette.text.secondary,
            opacity: 0.6,
            display: 'block',
          },
        })}
      >
        <pre
          style={{
            padding: '16px',
            margin: 0,
            fontSize: '12px',
            lineHeight: '1.4',
            overflow: wrapLines ? 'visible' : 'auto',
            whiteSpace: wrapLines ? 'pre-wrap' : 'pre',
            wordBreak: wrapLines ? 'break-all' : 'normal',
          }}
        >
          <code>
            {loading ? (
              <CodeSkeleton />
            ) : (
              blocks.map((block, index) =>
                block.className ? (
                  <span key={index} className={block.className}>
                    {block.text}
                  </span>
                ) : (
                  block.text
                ),
              )
            )}
          </code>
        </pre>
      </Box>
    </Paper>
  );
});

export default FileDiff;
