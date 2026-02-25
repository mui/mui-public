import * as React from 'react';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Skeleton from '@mui/material/Skeleton';
import CodeSkeleton from './CodeSkeleton';
import { getFileHashId } from '../utils/html';

interface FileContentProps {
  filePath: string;
  content: string;
  loading?: boolean;
}

const FileContent = React.memo(function FileContent({
  filePath,
  content,
  loading,
}: FileContentProps) {
  const fileId = getFileHashId(filePath);

  return (
    <Paper sx={{ overflow: 'hidden' }}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }} id={fileId}>
        {loading ? (
          <Skeleton width="40%" />
        ) : (
          <Link
            variant="subtitle2"
            fontFamily="monospace"
            color="text.secondary"
            href={`#${fileId}`}
          >
            {filePath}
          </Link>
        )}
      </Box>
      <pre
        style={{
          padding: '16px',
          margin: 0,
          fontSize: '12px',
          lineHeight: '1.4',
          overflow: 'auto',
          whiteSpace: 'pre',
        }}
      >
        <code>{loading ? <CodeSkeleton /> : content}</code>
      </pre>
    </Paper>
  );
});

export default FileContent;
