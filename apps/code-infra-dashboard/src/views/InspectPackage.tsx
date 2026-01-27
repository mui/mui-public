'use client';

import * as React from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEventCallback } from '@mui/material/utils';
import { useFileFilter, PLACEHOLDER } from '../hooks/useFileFilter';
import Heading from '../components/Heading';
import FileContent from '../components/FileContent';
import FileExplorer from '../components/FileExplorer';
import { usePackageContent } from '../lib/npmPackage';

export default function InspectPackage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [packageInput, setPackageInput] = React.useState(searchParams.get('package') || '');
  const [includeFilter, setIncludeFilter] = React.useState('');
  const [excludeFilter, setExcludeFilter] = React.useState('');
  const deferredIncludeFilter = React.useDeferredValue(includeFilter);
  const deferredExcludeFilter = React.useDeferredValue(excludeFilter);

  const packageSpec = searchParams.get('package');

  const pkgQuery = usePackageContent(packageSpec);
  const pkg = pkgQuery.data;

  const fileFilterFn = useFileFilter(deferredIncludeFilter, deferredExcludeFilter);

  const filteredFiles = React.useMemo(
    () => (pkg?.files ?? []).filter((file) => fileFilterFn(file.path)),
    [pkg, fileFilterFn],
  );

  const loading = pkgQuery.isLoading;
  const error = pkgQuery.error;

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
          }}
        >
          <TextField
            label="Package"
            size="small"
            placeholder="e.g., react@19.0.0, @mui/material@latest"
            value={packageInput}
            onChange={(event) => setPackageInput(event.target.value)}
            sx={{
              flex: { sm: 1 },
              width: { xs: '100%', sm: 'auto' },
              minWidth: '200px',
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
              mt: { xs: 1, sm: 0 },
            }}
          >
            Inspect
          </Button>
        </Box>
      </Box>

      {error ? <Alert severity="error">{error.message}</Alert> : null}

      {pkg ? (
        <Box>
          <Typography variant="h6" gutterBottom>
            {pkg.name}@{pkg.version}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {filteredFiles.length}/{pkg.files.length} files
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
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
          <Box sx={{ display: 'flex', gap: 2 }}>
            {filteredFiles.length > 0 ? (
              <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                <FileExplorer files={filteredFiles} title="Files" />
              </Box>
            ) : null}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
              {filteredFiles.length > 0 ? (
                filteredFiles.map((file) => (
                  <FileContent key={file.path} filePath={file.path} content={file.content} />
                ))
              ) : (
                <Alert severity="info">No files match the current filter.</Alert>
              )}
            </Box>
          </Box>
        </Box>
      ) : null}

      {loading ? <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 1 }} /> : null}
    </Box>
  );
}
