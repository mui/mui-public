import * as React from 'react';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import { escapeHtmlId } from '../utils/escapeHtmlId';

interface FileContentProps {
  filePath: string;
  content: string;
}

const FileContent = React.memo(function FileContent({ filePath, content }: FileContentProps) {
  const fileId = `file-${escapeHtmlId(filePath)}`;

  return (
    <Paper sx={{ overflow: 'hidden' }}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }} id={fileId}>
        <Link variant="subtitle2" fontFamily="monospace" color="text.secondary" href={`#${fileId}`}>
          {filePath}
        </Link>
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
        <code>{content}</code>
      </pre>
    </Paper>
  );
});

export default FileContent;
