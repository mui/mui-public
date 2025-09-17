import * as React from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import { useTheme } from '@mui/material/styles';

interface RichFileDiffProps {
  oldValue: string;
  newValue: string;
  filePath: string;
  oldHeader: string;
  newHeader: string;
  inline?: boolean;
}

export default function RichFileDiff({
  oldValue,
  newValue,
  filePath,
  oldHeader,
  newHeader,
  inline = false,
}: RichFileDiffProps) {
  const theme = useTheme();

  const customStyles = React.useMemo(
    () => ({
      variables: {
        light: {
          codeFoldGutterBackground: theme.palette.background.paper,
          codeFoldBackground: theme.palette.background.default,
          gutterBackground: theme.palette.background.paper,
          gutterBackgroundDark: theme.palette.grey[800],
          highlightBackground: theme.palette.action.hover,
          highlightGutterBackground: theme.palette.action.selected,
          codeFoldContentColor: theme.palette.text.secondary,
          gutterColor: theme.palette.text.secondary,
          addedBackground: theme.palette.mode === 'dark' ? '#1e3a20' : '#d4edda',
          addedColor: theme.palette.mode === 'dark' ? '#a3d9a5' : '#155724',
          removedBackground: theme.palette.mode === 'dark' ? '#3a1e1e' : '#f8d7da',
          removedColor: theme.palette.mode === 'dark' ? '#f1a1a1' : '#721c24',
          wordAddedBackground: theme.palette.mode === 'dark' ? '#2d5a2d' : '#acf2bd',
          wordRemovedBackground: theme.palette.mode === 'dark' ? '#5a2d2d' : '#fdb8c0',
          addedGutterBackground: theme.palette.mode === 'dark' ? '#1e3a20' : '#d4edda',
          removedGutterBackground: theme.palette.mode === 'dark' ? '#3a1e1e' : '#f8d7da',
          addedGutterColor: theme.palette.mode === 'dark' ? '#a3d9a5' : '#155724',
          removedGutterColor: theme.palette.mode === 'dark' ? '#f1a1a1' : '#721c24',
        },
      },
      diffContainer: {
        fontFamily: theme.typography.fontFamily,
        fontSize: '12px',
        lineHeight: '1.4',
        color: theme.palette.text.primary,
        backgroundColor: theme.palette.background.paper,
      },
    }),
    [theme],
  );

  return (
    <Paper sx={{ overflow: 'hidden' }}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle2" fontFamily="monospace" color="text.secondary">
          {filePath}
        </Typography>
      </Box>
      <ReactDiffViewer
        oldValue={oldValue}
        newValue={newValue}
        splitView={!inline}
        leftTitle={oldHeader}
        rightTitle={newHeader}
        hideLineNumbers={false}
        styles={customStyles}
        compareMethod={DiffMethod.LINES}
        useDarkTheme={theme.palette.mode === 'dark'}
      />
    </Paper>
  );
}
