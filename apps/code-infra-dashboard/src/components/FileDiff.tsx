import * as React from 'react';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import { useTheme } from '@mui/material/styles';
import * as diff from 'diff';

interface FileDiffProps {
  oldValue: string;
  newValue: string;
  filePath: string;
  oldHeader: string;
  newHeader: string;
  ignoreWhitespace: boolean;
  wrapLines?: boolean;
}

function getLineClass(line: string, index: number): string | null {
  if (index < 2) {
    return 'diff-preamble';
  }

  if (line.startsWith('+')) {
    return 'diff-added';
  }

  if (line.startsWith('-')) {
    return 'diff-removed';
  }

  if (line.startsWith('@@')) {
    return 'diff-hunk';
  }

  return null;
}

function escapeHtmlId(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

interface ProcessedDiff {
  fileName: string;
  blocks: { text: string; className: string | null }[];
}

function processDiff(
  filePath: string,
  oldValue: string,
  newValue: string,
  oldHeader: string,
  newHeader: string,
  ignoreWhitespace: boolean,
): ProcessedDiff {
  const fileDiff = diff.createPatch(filePath, oldValue, newValue, oldHeader, newHeader, {
    ignoreWhitespace,
  });

  const lines = fileDiff.split('\n');
  const rawHeaderLine = lines[0] || '';
  const contentLines = lines.slice(2); // Skip first two lines

  const blocks = contentLines.reduce<{ text: string; className: string | null }[]>(
    (acc, line, index) => {
      const className = getLineClass(line, index);
      const content = `${line}\n`;

      const lastBlock = acc[acc.length - 1];

      if (lastBlock && lastBlock.className === className) {
        lastBlock.text += content;
      } else {
        acc.push({ text: content, className });
      }

      return acc;
    },
    [],
  );

  const fileName = rawHeaderLine.replace(/^Index: /, '');

  return {
    fileName,
    blocks,
  };
}

export default function FileDiff({
  oldValue,
  newValue,
  filePath,
  oldHeader,
  newHeader,
  ignoreWhitespace,
  wrapLines = false,
}: FileDiffProps) {
  const theme = useTheme();

  const { fileName, blocks } = React.useMemo(
    () => processDiff(filePath, oldValue, newValue, oldHeader, newHeader, ignoreWhitespace),
    [oldValue, newValue, filePath, oldHeader, newHeader, ignoreWhitespace],
  );

  const fileId = `file-${escapeHtmlId(fileName)}`;

  return (
    <Paper sx={{ overflow: 'hidden' }}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }} id={fileId}>
        <Link variant="subtitle2" fontFamily="monospace" color="text.secondary" href={`#${fileId}`}>
          {fileName}
        </Link>
      </Box>
      <Box
        sx={{
          code: {
            minWidth: '100%',
            width: 'fit-content',
            display: 'block',
          },
          '& .diff-added': {
            backgroundColor: theme.palette.mode === 'dark' ? '#1e3a20' : '#d4edda',
            color: theme.palette.mode === 'dark' ? '#a3d9a5' : '#155724',
            display: 'block',
          },
          '& .diff-removed': {
            backgroundColor: theme.palette.mode === 'dark' ? '#3a1e1e' : '#f8d7da',
            color: theme.palette.mode === 'dark' ? '#f1a1a1' : '#721c24',
            display: 'block',
          },
          '& .diff-hunk': {
            color: theme.palette.primary.main,
            opacity: 0.8,
            fontWeight: 600,
            display: 'block',
          },
          '& .diff-preamble': {
            color: theme.palette.text.secondary,
            opacity: 0.6,
            display: 'block',
          },
        }}
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
            {blocks.map((block, index) =>
              block.className ? (
                <span key={index} className={block.className}>
                  {block.text}
                </span>
              ) : (
                block.text
              ),
            )}
          </code>
        </pre>
      </Box>
    </Paper>
  );
}
