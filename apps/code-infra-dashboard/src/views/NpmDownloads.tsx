'use client';

import * as React from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useQueries, UseQueryResult } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import Heading from '../components/Heading';
import PackageSearchbar from '../components/PackageSearchbar';
import NpmDownloadsChart from '../components/NpmDownloadsChart';
import {
  fetchPackageExpression,
  DOWNLOADS_PRESETS,
  getDefaultDateRange,
  getDefaultAggregation,
  getAvailableAggregations,
  AggregationPeriod,
  NpmDownloadsData,
} from '../lib/npmDownloads';

export type PackageQueryResult = UseQueryResult<NpmDownloadsData, Error>;

function formatDateForInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateFromInput(dateStr: string): Date | null {
  if (!dateStr) {
    return null;
  }
  const date = new Date(dateStr);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function NpmDownloads() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Parse URL params
  const packagesParam = searchParams.get('packages');
  const fromParam = searchParams.get('from');
  const untilParam = searchParams.get('until');
  const aggregationParam = searchParams.get('aggregation') as AggregationPeriod | null;
  const baselineParam = searchParams.get('baseline');

  const selectedPackages = React.useMemo(
    () => (packagesParam ? packagesParam.split(',').filter(Boolean) : []),
    [packagesParam],
  );

  const defaultRange = React.useMemo(() => getDefaultDateRange(), []);
  const fromDate = React.useMemo(
    () => parseDateFromInput(fromParam || '') || defaultRange.from,
    [fromParam, defaultRange.from],
  );
  const untilDate = React.useMemo(
    () => parseDateFromInput(untilParam || '') || defaultRange.until,
    [untilParam, defaultRange.until],
  );

  const availableAggregations = React.useMemo(
    () => getAvailableAggregations(fromDate, untilDate),
    [fromDate, untilDate],
  );
  const aggregation = React.useMemo(() => {
    if (aggregationParam && availableAggregations.includes(aggregationParam)) {
      return aggregationParam;
    }
    return getDefaultAggregation(fromDate, untilDate);
  }, [aggregationParam, availableAggregations, fromDate, untilDate]);

  const baseline = baselineParam && selectedPackages.includes(baselineParam) ? baselineParam : null;

  const [inputValue, setInputValue] = React.useState('');

  // Fetch downloads data - one query per package for individual caching
  const packageQueries = useQueries({
    queries: selectedPackages.map((pkg) => ({
      queryKey: ['npmDownloads', pkg, fromDate.toISOString(), untilDate.toISOString()],
      queryFn: () => fetchPackageExpression(pkg, fromDate, untilDate),
      staleTime: 10 * 60 * 1000,
    })),
  });

  // Create an object of package -> query result for easy access
  const queryByPackage = React.useMemo(
    () => Object.fromEntries(selectedPackages.map((pkg, i) => [pkg, packageQueries[i]])),
    [selectedPackages, packageQueries],
  );

  // URL builder helper
  const buildUrl = React.useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      return `${pathname}?${params.toString()}`;
    },
    [searchParams, pathname],
  );

  // URL update helper for imperative updates
  const updateSearchParams = React.useCallback(
    (updater: (params: URLSearchParams) => URLSearchParams) => {
      const newParams = updater(new URLSearchParams(searchParams.toString()));
      router.replace(`${pathname}?${newParams.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  const handlePackagesChange = React.useCallback(
    (packages: string[]) => {
      updateSearchParams((params) => {
        if (packages.length === 0) {
          params.delete('packages');
          params.delete('baseline');
        } else {
          params.set('packages', packages.join(','));
          // Clear baseline if removed from packages
          const currentBaseline = params.get('baseline');
          if (currentBaseline && !packages.includes(currentBaseline)) {
            params.delete('baseline');
          }
        }
        return params;
      });
      setInputValue('');
    },
    [updateSearchParams],
  );

  const handleFromChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updateSearchParams((params) => {
        const value = event.target.value;
        if (value) {
          params.set('from', value);
        } else {
          params.delete('from');
        }
        return params;
      });
    },
    [updateSearchParams],
  );

  const handleUntilChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updateSearchParams((params) => {
        const value = event.target.value;
        if (value) {
          params.set('until', value);
        } else {
          params.delete('until');
        }
        return params;
      });
    },
    [updateSearchParams],
  );

  const handleAggregationChange = React.useCallback(
    (newAggregation: AggregationPeriod) => {
      updateSearchParams((params) => {
        params.set('aggregation', newAggregation);
        return params;
      });
    },
    [updateSearchParams],
  );

  const handleRemove = React.useCallback(
    (pkg: string) => {
      handlePackagesChange(selectedPackages.filter((p) => p !== pkg));
    },
    [handlePackagesChange, selectedPackages],
  );

  return (
    <React.Fragment>
      <Heading level={1}>npm Package Downloads</Heading>

      {/* Presets Section */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Quick Presets
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {DOWNLOADS_PRESETS.map((preset) => (
            <Chip
              key={preset.name}
              label={preset.name}
              component={Link}
              href={buildUrl({ packages: preset.packages.join(','), baseline: null })}
              replace
              scroll={false}
              clickable
              color="primary"
              variant="outlined"
            />
          ))}
        </Box>
      </Paper>

      {/* Search and Date Range Section */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Select Packages to Compare
        </Typography>

        <PackageSearchbar
          multiple
          value={selectedPackages}
          onChange={handlePackagesChange}
          inputValue={inputValue}
          onInputChange={setInputValue}
          placeholder="Search and select packages..."
          label="Package names"
        />

        <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
          <TextField
            label="From"
            type="date"
            value={formatDateForInput(fromDate)}
            onChange={handleFromChange}
            size="small"
            slotProps={{
              inputLabel: { shrink: true },
            }}
          />
          <TextField
            label="Until"
            type="date"
            value={formatDateForInput(untilDate)}
            onChange={handleUntilChange}
            size="small"
            slotProps={{
              inputLabel: { shrink: true },
            }}
          />
        </Box>
      </Paper>

      {/* Visualization Section */}
      {selectedPackages.length > 0 ? (
        <Paper sx={{ p: 3 }}>
          <NpmDownloadsChart
            queryByPackage={queryByPackage}
            aggregation={aggregation}
            onAggregationChange={handleAggregationChange}
            availableAggregations={availableAggregations}
            baseline={baseline}
            baselineHref={(pkg) => buildUrl({ baseline: pkg })}
            onRemove={handleRemove}
          />
        </Paper>
      ) : (
        <Paper sx={{ p: 6, textAlign: 'center' }}>
          <Typography variant="h5" color="text.secondary" gutterBottom>
            Select packages to compare their download statistics
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Use the presets above or search for specific packages
          </Typography>
        </Paper>
      )}
    </React.Fragment>
  );
}
