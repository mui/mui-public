'use client';

import * as React from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import { useEventCallback } from '@mui/material/utils';
import IconButton from '@mui/material/IconButton';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import { useFilteredItems, PLACEHOLDER } from '../hooks/useFilteredItems';
import { useScrollToHash } from '../hooks/useScrollToHash';
import Heading from '../components/Heading';
import FileDiff from '../components/FileDiff';
import FileExplorer, { type ChangeType } from '../components/FileExplorer';
import { type PackageContents, usePackageContent } from '../lib/npmPackage';

const DiffContent = React.memo(function DiffContent({
  pkg1,
  pkg2,
  loading,
}: {
  pkg1: PackageContents | undefined;
  pkg2: PackageContents | undefined;
  loading: boolean;
}) {
  const [ignoreWhitespace, setIgnoreWhitespace] = React.useState(true);
  const [filter, setFilter] = React.useState('');

  const filesToDiff = React.useMemo(() => {
    if (!pkg1 || !pkg2) {
      return [];
    }

    const pkg1FileMap = new Map(pkg1.files.map((file) => [file.path, file]));
    const pkg2FileMap = new Map(pkg2.files.map((file) => [file.path, file]));

    const allFiles = new Set([...pkg1FileMap.keys(), ...pkg2FileMap.keys()]);

    const files: {
      path: string;
      old: string;
      new: string;
      oldHeader: string;
      newHeader: string;
      changeType: ChangeType;
    }[] = [];

    for (const filePath of Array.from(allFiles).sort()) {
      const file1 = pkg1FileMap.get(filePath);
      const file2 = pkg2FileMap.get(filePath);

      const content1 = file1?.content || '';
      const content2 = file2?.content || '';

      if (content1 !== content2) {
        let changeType: ChangeType;
        if (!file1) {
          changeType = 'added';
        } else if (!file2) {
          changeType = 'removed';
        } else {
          changeType = 'modified';
        }

        files.push({
          path: filePath,
          old: content1,
          new: content2,
          oldHeader: `${pkg1.name}@${pkg1.version}`,
          newHeader: `${pkg2.name}@${pkg2.version}`,
          changeType,
        });
      }
    }

    return files;
  }, [pkg1, pkg2]);

  const filteredFilesToDiff = useFilteredItems(filesToDiff, filter);

  // Scroll to the anchor element after async content loads
  useScrollToHash(filteredFilesToDiff);

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
              onChange={(event) => setIgnoreWhitespace(event.target.checked)}
              size="small"
            />
          }
          label="Ignore whitespace"
          sx={{ mr: 0, flexShrink: 0 }}
        />
      </Box>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <Box sx={{ display: { xs: 'none', md: 'block' }, width: 300, flexShrink: 0 }}>
          <FileExplorer
            files={filteredFilesToDiff}
            title={`Changed Files (${filteredFilesToDiff.length}/${filesToDiff.length})`}
            loading={loading}
          />
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          {/* eslint-disable-next-line no-nested-ternary */}
          {loading ? (
            Array.from({ length: 3 }, (_, i) => (
              <FileDiff
                key={i}
                filePath=""
                oldValue=""
                newValue=""
                oldHeader=""
                newHeader=""
                ignoreWhitespace={ignoreWhitespace}
                loading
              />
            ))
          ) : filteredFilesToDiff.length > 0 ? (
            filteredFilesToDiff.map(({ path, old, new: newContent, oldHeader, newHeader }) => (
              <FileDiff
                key={path}
                filePath={path}
                oldValue={old}
                newValue={newContent}
                oldHeader={oldHeader}
                newHeader={newHeader}
                ignoreWhitespace={ignoreWhitespace}
              />
            ))
          ) : (
            <Alert severity="info">
              {filesToDiff.length === 0
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

  const package1Spec = searchParams.get('package1');
  const package2Spec = searchParams.get('package2');

  const pkg1Query = usePackageContent(package1Spec);
  const pkg2Query = usePackageContent(package2Spec);
  const loading = pkg1Query.isLoading || pkg2Query.isLoading;

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

  // Sync input fields with URL parameters when they change
  React.useEffect(() => {
    setPackage1Input(searchParams.get('package1') || '');
    setPackage2Input(searchParams.get('package2') || '');
  }, [searchParams]);

  return (
    <Box sx={{ mt: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Box>
        <Heading level={1}>Package Diff Tool</Heading>
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
            error={!!pkg1Query.error}
            helperText={pkg1Query.error?.message}
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
            error={!!pkg2Query.error}
            helperText={pkg2Query.error?.message}
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

      <DiffContent
        pkg1={pkg1Query.data}
        pkg2={pkg2Query.data}
        loading={pkg1Query.isLoading || pkg2Query.isLoading}
      />
    </Box>
  );
}
