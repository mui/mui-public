'use client';

import * as React from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useQueries, UseQueryResult } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import { DateRangePicker } from '@mui/x-date-pickers-pro/DateRangePicker';
import { DateRange } from '@mui/x-date-pickers-pro/models';
import dayjs, { Dayjs } from 'dayjs';
import Heading from '../components/Heading';
import { NpmDownloadsLink } from '../components/NpmDownloadsLink';
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

function parseDateFromParam(dateStr: string | null): Dayjs | null {
  if (!dateStr) {
    return null;
  }
  const parsed = dayjs(dateStr);
  return parsed.isValid() ? parsed : null;
}

function formatDateForParam(date: Dayjs): string {
  return date.format('YYYY-MM-DD');
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
    () => parseDateFromParam(fromParam)?.toDate() ?? defaultRange.from,
    [fromParam, defaultRange.from],
  );
  const untilDate = React.useMemo(
    () => parseDateFromParam(untilParam)?.toDate() ?? defaultRange.until,
    [untilParam, defaultRange.until],
  );
  const dateRangeValue = React.useMemo<DateRange<Dayjs>>(
    () => [dayjs(fromDate), dayjs(untilDate)],
    [fromDate, untilDate],
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

  // URL update helper for imperative updates
  const updateSearchParams = React.useCallback(
    (updater: (params: URLSearchParams) => URLSearchParams) => {
      const newParams = updater(new URLSearchParams(searchParams.toString()));
      router.replace(`${pathname}?${newParams.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  const handleAddPackage = React.useCallback(
    (packageName: string) => {
      if (selectedPackages.includes(packageName)) {
        return;
      }
      updateSearchParams((params) => {
        const packages = [...selectedPackages, packageName];
        params.set('packages', packages.join(','));
        return params;
      });
    },
    [updateSearchParams, selectedPackages],
  );

  const handleRemovePackage = React.useCallback(
    (packageName: string) => {
      updateSearchParams((params) => {
        const packages = selectedPackages.filter((p) => p !== packageName);
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
    },
    [updateSearchParams, selectedPackages],
  );

  const handleDateRangeChange = React.useCallback(
    (newValue: DateRange<Dayjs>) => {
      updateSearchParams((params) => {
        const [newFrom, newUntil] = newValue;
        if (newFrom?.isValid()) {
          params.set('from', formatDateForParam(newFrom));
        } else {
          params.delete('from');
        }
        if (newUntil?.isValid()) {
          params.set('until', formatDateForParam(newUntil));
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

  return (
    <React.Fragment>
      <Heading level={1}>npm Package Downloads</Heading>

      {/* Presets Section */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Quick Presets
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {DOWNLOADS_PRESETS.map((preset) => (
            <Chip
              key={preset.name}
              label={preset.name}
              component={NpmDownloadsLink}
              packages={preset.packages}
              baseline={null}
              clickable
              color="primary"
              variant="outlined"
            />
          ))}
        </Box>
      </Box>

      {/* Search and Date Range Section */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Select Packages to Compare
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Use + to combine packages (e.g.,{' '}
          <NpmDownloadsLink packages={['@base-ui-components/react+@base-ui/react']}>
            @base-ui-components/react + @base-ui/react
          </NpmDownloadsLink>
          )
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <PackageSearchbar
            onPackageSelect={handleAddPackage}
            placeholder="Search and select packages..."
            label="Package names"
            sx={{ flex: 1 }}
          />
          <DateRangePicker
            value={dateRangeValue}
            onChange={handleDateRangeChange}
            localeText={{ start: 'From', end: 'Until' }}
            slotProps={{
              textField: { size: 'small' },
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
            onRemove={handleRemovePackage}
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
