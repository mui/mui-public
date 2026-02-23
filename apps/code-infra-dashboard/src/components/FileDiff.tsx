import * as React from 'react';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Skeleton from '@mui/material/Skeleton';
import * as diff from 'diff';
import CodeSkeleton from './CodeSkeleton';
import { escapeHtmlId } from '../utils/escapeHtmlId';

interface FileDiffProps {
  oldValue: string;
  newValue: string;
  filePath: string;
  oldHeader: string;
  newHeader: string;
  ignoreWhitespace: boolean;
  wrapLines?: boolean;
  loading?: boolean;
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
  const fileName = rawHeaderLine.replace(/^Index: /, '');

  const blocks: { text: string; className: string | null }[] = [];

  const contentLines = lines.slice(2); // Skip first two lines ("Index: <filename>" and "===")
  for (let index = 0; index < contentLines.length; index += 1) {
    const line = contentLines[index];
    const className = getLineClass(line, index);
    const content = `${line}\n`;

    const lastBlock = blocks[blocks.length - 1];

    if (lastBlock && lastBlock.className === className) {
      lastBlock.text += content;
    } else {
      blocks.push({ text: content, className });
    }
  }

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
  loading,
}: FileDiffProps) {
  const { fileName, blocks } = React.useMemo(
    () => processDiff(filePath, oldValue, newValue, oldHeader, newHeader, ignoreWhitespace),
    [oldValue, newValue, filePath, oldHeader, newHeader, ignoreWhitespace],
  );

  const fileId = `file-${escapeHtmlId(fileName)}`;

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
            {fileName}
          </Link>
        )}
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
}
