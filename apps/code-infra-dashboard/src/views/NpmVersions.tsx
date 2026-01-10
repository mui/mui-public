'use client';

import * as React from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Heading from '../components/Heading';
import NpmVersionBreakdown from '../components/NpmVersionBreakdown';
import PackageSearchbar from '../components/PackageSearchbar';

export default function NpmVersions() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const packageParam = searchParams.get('package');
  const versionParam = searchParams.get('version');

  const updateSearchParams = React.useCallback(
    (updater: (params: URLSearchParams) => URLSearchParams) => {
      const newParams = updater(new URLSearchParams(searchParams.toString()));
      router.replace(`${pathname}?${newParams.toString()}`);
    },
    [searchParams, router, pathname],
  );

  const handlePackageSelect = (packageName: string) => {
    updateSearchParams((params) => {
      params.set('package', packageName);
      params.delete('version'); // Clear version when package changes
      return params;
    });
  };

  const handleVersionChange = (version: string | null) => {
    updateSearchParams((params) => {
      if (version) {
        params.set('version', version);
      } else {
        params.delete('version');
      }
      return params;
    });
  };

  return (
    <React.Fragment>
      <Heading level={1}>npm Package Version Breakdown</Heading>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Search for an npm package
        </Typography>

        <PackageSearchbar
          onPackageSelect={handlePackageSelect}
          placeholder="e.g., react, lodash, express"
          label="Package name"
        />
      </Paper>

      {/* Package Details and Version Breakdown */}
      {packageParam && (
        <Paper sx={{ p: 3 }}>
          <NpmVersionBreakdown
            packageName={packageParam}
            selectedVersion={versionParam}
            onVersionChange={handleVersionChange}
          />
        </Paper>
      )}

      {/* Empty State */}
      {!packageParam && (
        <Paper sx={{ p: 6, textAlign: 'center' }}>
          <Typography variant="h5" color="text.secondary" gutterBottom>
            Search for an npm package to view its download statistics
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Explore download distributions by major/minor versions and click pie chart slices to
            drill down
          </Typography>
        </Paper>
      )}
    </React.Fragment>
  );
}
