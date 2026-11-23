'use client';

import * as React from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import TextField from '@mui/material/TextField';
import { useEventCallback } from '@mui/material/utils';
import IconButton from '@mui/material/IconButton';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import { useFilteredItems, PLACEHOLDER } from '../hooks/useFilteredItems';
import { scrollToHash } from '../utils/dom';
import Heading from '../components/Heading';
import FileDiff from '../components/FileDiff';
import FileExplorer from '../components/FileExplorer';
import type { FileDiffResult } from '../lib/packageDiff/computePackageDiff';
import type { PackageOutcome } from '../lib/packageDiff/protocol';
import { usePackageDiff } from '../lib/packageDiff/usePackageDiff';

const EMPTY_FILES: FileDiffResult[] = [];
const EMPTY_BLOCKS: FileDiffResult['blocks'] = [];

function getPackageError(outcome: PackageOutcome | undefined): string | undefined {
  return outcome && 'error' in outcome ? outcome.error : undefined;
}

const DiffContent = React.memo(function DiffContent({
  files,
  loading,
  updating,
  ignoreWhitespace,
  onIgnoreWhitespaceChange,
  format,
  onFormatChange,
}: {
  files: FileDiffResult[];
  loading: boolean;
  updating: boolean;
  ignoreWhitespace: boolean;
  onIgnoreWhitespaceChange: (value: boolean) => void;
  format: boolean;
  onFormatChange: (value: boolean) => void;
}) {
  const [filter, setFilter] = React.useState('');

  const filteredFiles = useFilteredItems(files, filter);

  // Scroll to the anchor element after async content loads
  React.useEffect(() => {
    scrollToHash();
  }, [filteredFiles]);

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          mb: 2,
          flexDirection: { xs: 'column', sm: 'row' },
        }}
      >
        <TextField
          size="small"
          label="Filter"
          placeholder={PLACEHOLDER}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          sx={{ flex: { sm: 1 }, width: { xs: '100%', sm: 'auto' } }}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={ignoreWhitespace}
              onChange={(event) => onIgnoreWhitespaceChange(event.target.checked)}
              size="small"
            />
          }
          label="Ignore whitespace"
          sx={{ mr: 0, flexShrink: 0 }}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={format}
              onChange={(event) => onFormatChange(event.target.checked)}
              size="small"
            />
          }
          label="Format code"
          title="Format JavaScript, TypeScript, JSON and CSS with Prettier before diffing, so differences in build tool output style don't show up"
          sx={{ mr: 0, flexShrink: 0 }}
        />
      </Box>
      <LinearProgress sx={{ mb: 2, visibility: updating ? 'visible' : 'hidden' }} />
      <Box sx={{ display: 'flex', gap: 2 }}>
        <Box sx={{ display: { xs: 'none', md: 'block' }, width: 300, flexShrink: 0 }}>
          <FileExplorer
            files={filteredFiles}
            title={`Changed Files (${filteredFiles.length}/${files.length})`}
            loading={loading}
          />
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          {/* eslint-disable-next-line no-nested-ternary */}
          {loading ? (
            Array.from({ length: 3 }, (_, i) => (
              <FileDiff key={i} fileName="" blocks={EMPTY_BLOCKS} loading />
            ))
          ) : filteredFiles.length > 0 ? (
            filteredFiles.map(({ path, blocks, formatError }) => (
              <FileDiff key={path} fileName={path} blocks={blocks} formatError={formatError} />
            ))
          ) : (
            <Alert severity="info">
              {files.length === 0
                ? 'No differences found between the packages.'
                : 'No files match the current filter.'}
            </Alert>
          )}
        </Box>
      </Box>
    </Box>
  );
});

export default function DiffPackage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [package1Input, setPackage1Input] = React.useState(searchParams.get('package1') || '');
  const [package2Input, setPackage2Input] = React.useState(searchParams.get('package2') || '');
  const [ignoreWhitespace, setIgnoreWhitespace] = React.useState(true);

  // Sync input fields with URL parameters when they change. Re-seed the editable
  // inputs during render whenever the searchParams reference changes (back/forward,
  // shared link, programmatic router change, or after Compare). This is the
  // documented "adjusting state during render when an input changes" pattern.
  const [previousSearchParams, setPreviousSearchParams] = React.useState(searchParams);
  if (previousSearchParams !== searchParams) {
    setPreviousSearchParams(searchParams);
    setPackage1Input(searchParams.get('package1') || '');
    setPackage2Input(searchParams.get('package2') || '');
  }

  const package1Spec = searchParams.get('package1');
  const package2Spec = searchParams.get('package2');
  const format = searchParams.get('format') === '1';

  const diffQuery = usePackageDiff(package1Spec, package2Spec, { ignoreWhitespace, format });
  const loading = diffQuery.isLoading;
  const package1Error = getPackageError(diffQuery.data?.oldPackage);
  const package2Error = getPackageError(diffQuery.data?.newPackage);

  const onSwapPackages = useEventCallback(() => {
    const temp = package1Input;
    setPackage1Input(package2Input);
    setPackage2Input(temp);
  });

  const onCompareClick = useEventCallback(() => {
    const pkg1Spec = package1Input.trim();
    const pkg2Spec = package2Input.trim();

    if (!pkg1Spec || !pkg2Spec) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set('package1', pkg1Spec);
    params.set('package2', pkg2Spec);
    router.replace(`${pathname}?${params.toString()}`);
  });

  const onFormatChange = useEventCallback((value: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set('format', '1');
    } else {
      params.delete('format');
    }
    router.replace(`${pathname}?${params.toString()}`);
  });

  return (
    <Box sx={{ mt: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Box>
        <Heading level={1}>npm package diff tool</Heading>
        <Box
          component="form"
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault();
            onCompareClick();
          }}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexDirection: { xs: 'column', sm: 'row' },
            width: '100%',
            mb: { sm: 3 },
          }}
        >
          <TextField
            label="From"
            size="small"
            placeholder="e.g., react@18.0.0, @mui/material@~5.0.0"
            value={package1Input}
            onChange={(event) => setPackage1Input(event.target.value)}
            error={!!package1Error}
            helperText={package1Error}
            sx={{
              flex: { sm: 1 },
              width: { xs: '100%', sm: 'auto' },
              minWidth: '200px',
              position: 'relative',
              '& .MuiFormHelperText-root': {
                position: { sm: 'absolute' },
                top: { sm: '100%' },
              },
            }}
          />

          <IconButton
            onClick={onSwapPackages}
            size="small"
            sx={{ alignSelf: 'center' }}
            title="Swap packages"
          >
            <SwapHorizIcon sx={{ display: { xs: 'none', sm: 'block' } }} />
            <SwapVertIcon sx={{ display: { xs: 'block', sm: 'none' } }} />
          </IconButton>

          <TextField
            label="To"
            size="small"
            placeholder="e.g., react@19.0.0, @mui/material@6.x"
            value={package2Input}
            onChange={(event) => setPackage2Input(event.target.value)}
            error={!!package2Error}
            helperText={package2Error}
            sx={{
              flex: { sm: 1 },
              width: { xs: '100%', sm: 'auto' },
              minWidth: '200px',
              position: 'relative',
              '& .MuiFormHelperText-root': {
                position: { sm: 'absolute' },
                top: { sm: '100%' },
              },
            }}
          />

          <Button
            type="submit"
            variant="contained"
            disabled={loading || !package1Input.trim() || !package2Input.trim()}
            loading={loading}
            sx={{
              minWidth: 'auto',
              width: { xs: '100%', sm: 'auto' },
            }}
          >
            Compare
          </Button>
        </Box>
      </Box>

      {diffQuery.error ? <Alert severity="error">{diffQuery.error.message}</Alert> : null}

      {diffQuery.data?.files === null ? null : (
        <DiffContent
          files={diffQuery.data?.files ?? EMPTY_FILES}
          loading={loading}
          updating={diffQuery.isPlaceholderData && diffQuery.isFetching}
          ignoreWhitespace={ignoreWhitespace}
          onIgnoreWhitespaceChange={setIgnoreWhitespace}
          format={format}
          onFormatChange={onFormatChange}
        />
      )}
    </Box>
  );
}
