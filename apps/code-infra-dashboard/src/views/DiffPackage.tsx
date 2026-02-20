'use client';

import * as React from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Skeleton from '@mui/material/Skeleton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEventCallback } from '@mui/material/utils';
import IconButton from '@mui/material/IconButton';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import { useFileFilter, PLACEHOLDER } from '../hooks/useFileFilter';
import Heading from '../components/Heading';
import FileDiff from '../components/FileDiff';
import FileExplorer from '../components/FileExplorer';
import { usePackageContent } from '../lib/npmPackage';

// Component for displaying individual package info
interface PackageInfoProps {
  label: string;
  color: 'primary' | 'secondary';
  resolvedSpec: string | null;
  error: Error | null;
}

function PackageInfo({ label, color, resolvedSpec, error }: PackageInfoProps) {
  return (
    <Box>
      <Typography variant="subtitle2" color={color}>
        {label}:
      </Typography>
      <Typography variant="body2" color={error ? 'error' : undefined} fontFamily="monospace">
        {error
          ? `Error: ${error.message}`
          : resolvedSpec || <Skeleton variant="text" width={300} />}
      </Typography>
    </Box>
  );
}

export default function DiffPackage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [package1Input, setPackage1Input] = React.useState(searchParams.get('package1') || '');
  const [package2Input, setPackage2Input] = React.useState(searchParams.get('package2') || '');
  const [ignoreWhitespace, setIgnoreWhitespace] = React.useState(true);
  const [includeFilter, setIncludeFilter] = React.useState('');
  const [excludeFilter, setExcludeFilter] = React.useState('');
  const deferredIncludeFilter = React.useDeferredValue(includeFilter);
  const deferredExcludeFilter = React.useDeferredValue(excludeFilter);

  const package1Spec = searchParams.get('package1');
  const package2Spec = searchParams.get('package2');

  const pkg1Query = usePackageContent(package1Spec);
  const pkg2Query = usePackageContent(package2Spec);

  const pkg1 = pkg1Query.data;
  const pkg2 = pkg2Query.data;

  const fileFilterFn = useFileFilter(deferredIncludeFilter, deferredExcludeFilter);

  const filesToDiff = React.useMemo(() => {
    if (!pkg1 || !pkg2) {
      return [];
    }

    const pkg1FileMap = new Map(pkg1.files.map((file) => [file.path, file]));
    const pkg2FileMap = new Map(pkg2.files.map((file) => [file.path, file]));

    const allFiles = new Set([...pkg1FileMap.keys(), ...pkg2FileMap.keys()]);

    const files: {
      filePath: string;
      old: string;
      new: string;
      oldHeader: string;
      newHeader: string;
    }[] = [];

    for (const filePath of Array.from(allFiles).sort()) {
      const file1 = pkg1FileMap.get(filePath);
      const file2 = pkg2FileMap.get(filePath);

      const content1 = file1?.content || '';
      const content2 = file2?.content || '';

      if (content1 !== content2) {
        files.push({
          filePath,
          old: content1,
          new: content2,
          oldHeader: `${pkg1.name}@${pkg1.version}`,
          newHeader: `${pkg2.name}@${pkg2.version}`,
        });
      }
    }

    return files;
  }, [pkg1, pkg2]);

  const filteredFilesToDiff = React.useMemo(
    () => filesToDiff.filter(({ filePath }) => fileFilterFn(filePath)),
    [filesToDiff, fileFilterFn],
  );

  const loading = pkg1Query.isLoading || pkg2Query.isLoading;
  const error = pkg1Query.error || pkg2Query.error;

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
          }}
        >
          <TextField
            label="From"
            size="small"
            placeholder="e.g., react@18.0.0, @mui/material@~5.0.0"
            value={package1Input}
            onChange={(event) => setPackage1Input(event.target.value)}
            sx={{
              flex: { sm: 1 },
              width: { xs: '100%', sm: 'auto' },
              minWidth: '200px',
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
            sx={{
              flex: { sm: 1 },
              width: { xs: '100%', sm: 'auto' },
              minWidth: '200px',
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
              mt: { xs: 1, sm: 0 },
            }}
          >
            Compare
          </Button>
        </Box>
      </Box>

      {(package1Spec || package2Spec) && (
        <Box sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
          <Typography variant="h6" gutterBottom>
            Resolved Packages:
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4, flexWrap: 'wrap' }}>
            <PackageInfo
              label="From"
              color="primary"
              resolvedSpec={pkg1 ? `${pkg1.name}@${pkg1.version}` : null}
              error={pkg1Query.error}
            />
            <PackageInfo
              label="To"
              color="secondary"
              resolvedSpec={pkg2 ? `${pkg2.name}@${pkg2.version}` : null}
              error={pkg2Query.error}
            />
          </Box>
        </Box>
      )}

      {!error && (
        <Box>
          <Box sx={{ mb: 2 }}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 2,
                flexWrap: 'wrap',
              }}
            >
              <Typography variant="h6">
                Diff Results{' '}
                {loading ? '' : `(${filteredFilesToDiff.length}/${filesToDiff.length} files):`}
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={ignoreWhitespace}
                    onChange={(event) => setIgnoreWhitespace(event.target.checked)}
                    size="small"
                  />
                }
                label="Ignore whitespace"
                sx={{ mr: 0 }}
              />
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                size="small"
                label="Include"
                placeholder={PLACEHOLDER}
                value={includeFilter}
                onChange={(event) => setIncludeFilter(event.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                size="small"
                label="Exclude"
                placeholder="e.g., node_modules, *.test.ts"
                value={excludeFilter}
                onChange={(event) => setExcludeFilter(event.target.value)}
                sx={{ flex: 1 }}
              />
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            {filteredFilesToDiff.length > 0 && !loading ? (
              <Box sx={{ display: { xs: 'none', md: 'block' }, width: 300, flexShrink: 0 }}>
                <FileExplorer
                  files={filteredFilesToDiff.map(({ filePath }) => ({ path: filePath }))}
                  title="Changed Files"
                />
              </Box>
            ) : null}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
              {loading ? (
                <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 1 }} />
              ) : (
                <React.Fragment>
                  {filteredFilesToDiff.length > 0 ? (
                    filteredFilesToDiff.map(
                      ({ filePath, old, new: newContent, oldHeader, newHeader }) => (
                        <FileDiff
                          key={filePath}
                          filePath={filePath}
                          oldValue={old}
                          newValue={newContent}
                          oldHeader={oldHeader}
                          newHeader={newHeader}
                          ignoreWhitespace={ignoreWhitespace}
                        />
                      ),
                    )
                  ) : (
                    <Alert severity="info">
                      {filesToDiff.length === 0
                        ? 'No differences found between the packages.'
                        : 'No files match the current filter.'}
                    </Alert>
                  )}
                </React.Fragment>
              )}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}
