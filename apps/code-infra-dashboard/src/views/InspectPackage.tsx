'use client';

import * as React from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { useEventCallback } from '@mui/material/utils';
import NextLink from 'next/link';
import { useFilteredItems, PLACEHOLDER } from '../hooks/useFilteredItems';
import { scrollToHash } from '../utils/dom';
import Heading from '../components/Heading';
import FileContent from '../components/FileContent';
import FileExplorer from '../components/FileExplorer';
import { type PackageContents, usePackageContent } from '../lib/npmPackage';

const PackageContent = React.memo(function PackageContent({
  pkg,
  loading,
}: {
  pkg: PackageContents | undefined;
  loading: boolean;
}) {
  const [filter, setFilter] = React.useState('');

  const filteredFiles = useFilteredItems(pkg?.files ?? [], filter);

  // Scroll to the anchor element after async content loads
  React.useEffect(() => {
    scrollToHash();
  }, [filteredFiles]);

  return (
    <Box>
      <TextField
        size="small"
        label="Filter"
        placeholder={PLACEHOLDER}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        fullWidth
        sx={{ mb: 2 }}
      />
      <Box sx={{ display: 'flex', gap: 2 }}>
        <Box sx={{ display: { xs: 'none', md: 'block' }, width: 300, flexShrink: 0 }}>
          <FileExplorer
            files={filteredFiles}
            title={`Files (${filteredFiles.length}/${pkg?.files.length ?? 0})`}
            loading={loading}
          />
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          {/* eslint-disable-next-line no-nested-ternary */}
          {loading ? (
            Array.from({ length: 3 }, (_, i) => (
              <FileContent key={i} filePath="" content="" loading />
            ))
          ) : filteredFiles.length > 0 ? (
            filteredFiles.map((file) => (
              <FileContent key={file.path} filePath={file.path} content={file.content} />
            ))
          ) : (
            <Alert severity="info">No files match the current filter.</Alert>
          )}
        </Box>
      </Box>
    </Box>
  );
});

export default function InspectPackage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [packageInput, setPackageInput] = React.useState(searchParams.get('package') || '');

  const packageSpec = searchParams.get('package');

  const pkgQuery = usePackageContent(packageSpec);
  const loading = pkgQuery.isLoading;
  const pkg = pkgQuery.data;

  const onInspectClick = useEventCallback(() => {
    const spec = packageInput.trim();

    if (!spec) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set('package', spec);
    router.replace(`${pathname}?${params.toString()}`);
  });

  // Sync input field with URL parameter when it changes
  React.useEffect(() => {
    setPackageInput(searchParams.get('package') || '');
  }, [searchParams]);

  return (
    <Box sx={{ mt: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Box>
        <Heading level={1}>Inspect Package</Heading>
        <Box
          component="form"
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault();
            onInspectClick();
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
            label="Package"
            size="small"
            placeholder="e.g., react@19.0.0, https://pkg.pr.new/@mui/material@1234"
            value={packageInput}
            onChange={(event) => setPackageInput(event.target.value)}
            error={!!pkgQuery.error}
            helperText={pkgQuery.error?.message}
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
            disabled={loading || !packageInput.trim()}
            loading={loading}
            sx={{
              minWidth: 'auto',
              width: { xs: '100%', sm: 'auto' },
            }}
          >
            Inspect
          </Button>
          <Button
            size="small"
            component={NextLink}
            disabled={!pkg}
            href={pkg ? `/diff-package?package1=${encodeURIComponent(pkg.resolved)}` : '#'}
            sx={{
              minWidth: 'auto',
              width: { xs: '100%', sm: 'auto' },
            }}
          >
            Compare versions
          </Button>
        </Box>
      </Box>

      <PackageContent pkg={pkgQuery.data} loading={pkgQuery.isLoading} />
    </Box>
  );
}
