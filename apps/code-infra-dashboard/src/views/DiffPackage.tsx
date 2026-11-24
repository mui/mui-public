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
import { escapeHtmlId, scrollToHash } from '../utils/dom';
import Heading from '../components/Heading';
import FileDiff from '../components/FileDiff';
import FileExplorer from '../components/FileExplorer';
import { useSearchParamsState } from '../hooks/useSearchParamsState';
import CopyButton from '../components/CopyButton';
import type { ChangedFile, DiffOptions } from '../lib/packageDiff/packageDiff';
import { usePackageDiff } from '../lib/packageDiff/usePackageDiff';
import type { PackageDiffState } from '../lib/packageDiff/usePackageDiff';

const EMPTY_FILES: ChangedFile[] = [];

const CODEC_FLAG = {
  defaultValue: false,
  serialize: (value: boolean) => (value ? '1' : ''),
  deserialize: (value: string) => value === '1',
};

const SEARCH_PARAMS_CONFIG = {
  format: CODEC_FLAG,
  removeComments: CODEC_FLAG,
};

const DiffContent = React.memo(function DiffContent({
  diff,
  loading,
  streaming,
  previous,
  options,
  onOptionsChange,
}: {
  diff: PackageDiffState | undefined;
  loading: boolean;
  /** Results are still coming in. */
  streaming: boolean;
  /** `diff` is the one for the previous options, until the new one starts streaming. */
  previous: boolean;
  options: DiffOptions;
  onOptionsChange: (options: Partial<DiffOptions>) => void;
}) {
  const [filter, setFilter] = React.useState('');

  const files = diff?.files ?? EMPTY_FILES;
  const results = diff?.results;
  const filteredFiles = useFilteredItems(files, filter);

  // Scroll to the anchor once its diff is in. Diffs arrive in display order, so the cards
  // above it have their final size by then.
  const scrolledRef = React.useRef(false);
  React.useEffect(() => {
    if (files.length === 0) {
      // A new package pair
      scrolledRef.current = false;
      return;
    }
    if (scrolledRef.current) {
      return;
    }
    const hash = window.location.hash.slice(1);
    const target = files.find((file) => `file-${escapeHtmlId(file.path)}` === hash);
    if (!target || results?.has(target.path)) {
      scrolledRef.current = true;
      scrollToHash();
    }
  }, [files, results]);

  const copyText = React.useMemo(
    () =>
      streaming || !results
        ? ''
        : filteredFiles
            .map(
              ({ path }) =>
                results
                  .get(path)
                  ?.blocks.map((block) => block.text)
                  .join('') ?? '',
            )
            .join(''),
    [streaming, filteredFiles, results],
  );

  const progress = diff?.total ? (diff.results.size / diff.total) * 100 : 0;

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
              checked={options.ignoreWhitespace}
              onChange={(event) => onOptionsChange({ ignoreWhitespace: event.target.checked })}
              size="small"
            />
          }
          label="Ignore whitespace"
          sx={{ mr: 0, flexShrink: 0 }}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={options.format}
              onChange={(event) => onOptionsChange({ format: event.target.checked })}
              size="small"
            />
          }
          label="Format code"
          title="Format JavaScript, TypeScript, JSON and CSS with Prettier before diffing, so differences in build tool output style don't show up"
          sx={{ mr: 0, flexShrink: 0 }}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={options.removeComments}
              onChange={(event) => onOptionsChange({ removeComments: event.target.checked })}
              size="small"
            />
          }
          disabled={!options.format}
          label="Remove comments"
          title="Leave comments out of the formatted code, so differences in comments, license headers and annotations don't show up"
          sx={{ mr: 0, flexShrink: 0 }}
        />
        <CopyButton
          text={copyText}
          disabled={!copyText}
          title={streaming ? 'Copy diff (available once all files are diffed)' : 'Copy diff'}
        />
      </Box>
      <LinearProgress
        variant={previous ? 'indeterminate' : 'determinate'}
        value={progress}
        sx={{ mb: 2, visibility: streaming && !loading ? 'visible' : 'hidden' }}
      />
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
            Array.from({ length: 3 }, (_, i) => <FileDiff key={i} fileName="" loading />)
          ) : filteredFiles.length > 0 ? (
            filteredFiles.map(({ path }) => {
              const result = results?.get(path);
              return (
                <FileDiff
                  key={path}
                  fileName={path}
                  blocks={result?.blocks}
                  formatError={result?.formatError}
                />
              );
            })
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
  const [{ format, removeComments }, setParams] = useSearchParamsState(SEARCH_PARAMS_CONFIG, {
    replace: true,
  });
  const options = React.useMemo(
    () => ({ ignoreWhitespace, format, removeComments }),
    [ignoreWhitespace, format, removeComments],
  );

  const diffQuery = usePackageDiff(package1Spec, package2Spec, {
    ...options,
    // Doesn't apply without formatting, keep it out of the cache key then
    removeComments: format && removeComments,
  });
  const loading = diffQuery.isLoading;
  const package1Error = diffQuery.error?.oldError;
  const package2Error = diffQuery.error?.newError;

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

  const onOptionsChange = useEventCallback(
    ({ ignoreWhitespace: newIgnoreWhitespace, ...params }: Partial<DiffOptions>) => {
      if (newIgnoreWhitespace !== undefined) {
        setIgnoreWhitespace(newIgnoreWhitespace);
      }
      if (Object.keys(params).length > 0) {
        setParams(params);
      }
    },
  );

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

      {/* Download failures show under their input instead */}
      {diffQuery.error && !package1Error && !package2Error ? (
        <Alert severity="error">{diffQuery.error.message}</Alert>
      ) : null}

      {diffQuery.error ? null : (
        <DiffContent
          diff={diffQuery.data}
          loading={loading}
          streaming={diffQuery.isFetching}
          previous={diffQuery.isPlaceholderData}
          options={options}
          onOptionsChange={onOptionsChange}
        />
      )}
    </Box>
  );
}
