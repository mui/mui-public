'use client';

import * as React from 'react';
import { useQueries, UseQueryResult } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import { DateRange } from '@mui/x-date-pickers-pro/models';
import { Dayjs } from 'dayjs';
import {
  useSearchParamsState,
  CODEC_STRING_ARRAY,
  CODEC_DAYJS_DATE,
} from '../hooks/useSearchParamsState';
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

export default function NpmDownloads() {
  const defaultRange = React.useMemo(() => getDefaultDateRange(), []);

  // URL params with useSearchParamsState
  const [params, setParams] = useSearchParamsState(
    {
      packages: { defaultValue: [] as string[], ...CODEC_STRING_ARRAY },
      from: { defaultValue: defaultRange.from, ...CODEC_DAYJS_DATE },
      until: { defaultValue: defaultRange.until, ...CODEC_DAYJS_DATE },
      aggregation: { defaultValue: '' },
      baseline: { defaultValue: '' },
    },
    { replace: true },
  );

  const dateRangeValue = React.useMemo<DateRange<Dayjs>>(
    () => [params.from, params.until],
    [params.from, params.until],
  );

  const availableAggregations = React.useMemo(
    () => getAvailableAggregations(params.from.toDate(), params.until.toDate()),
    [params.from, params.until],
  );

  const aggregation = React.useMemo(() => {
    if (
      params.aggregation &&
      availableAggregations.includes(params.aggregation as AggregationPeriod)
    ) {
      return params.aggregation as AggregationPeriod;
    }
    return getDefaultAggregation(params.from.toDate(), params.until.toDate());
  }, [params.aggregation, availableAggregations, params.from, params.until]);

  const baseline = React.useMemo(
    () => (params.baseline && params.packages.includes(params.baseline) ? params.baseline : null),
    [params.baseline, params.packages],
  );

  // Fetch downloads data - one query per package for individual caching
  const packageQueries = useQueries({
    queries: params.packages.map((pkg) => ({
      queryKey: ['npmDownloads', pkg, params.from.toISOString(), params.until.toISOString()],
      queryFn: () => fetchPackageExpression(pkg, params.from.toDate(), params.until.toDate()),
      staleTime: 10 * 60 * 1000,
    })),
  });

  // Create an object of package -> query result for easy access
  const queryByPackage = React.useMemo(
    () => Object.fromEntries(params.packages.map((pkg, i) => [pkg, packageQueries[i]])),
    [params.packages, packageQueries],
  );

  const handleAddPackage = React.useCallback(
    (packageName: string) => {
      if (params.packages.includes(packageName)) {
        return;
      }
      setParams({ packages: [...params.packages, packageName] });
    },
    [params.packages, setParams],
  );

  const handleDateRangeChange = React.useCallback(
    (newValue: DateRange<Dayjs>) => {
      const [newFrom, newUntil] = newValue;
      setParams({
        ...(newFrom?.isValid() && { from: newFrom }),
        ...(newUntil?.isValid() && { until: newUntil }),
      });
    },
    [setParams],
  );

  const handleAggregationChange = React.useCallback(
    (newAggregation: AggregationPeriod) => {
      setParams({ aggregation: newAggregation });
    },
    [setParams],
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

        <PackageSearchbar
          onPackageSelect={handleAddPackage}
          placeholder="Search and select packages..."
          label="Package names"
        />
      </Paper>

      {/* Visualization Section */}
      {params.packages.length > 0 ? (
        <Paper sx={{ p: 3 }}>
          <NpmDownloadsChart
            queryByPackage={queryByPackage}
            aggregation={aggregation}
            onAggregationChange={handleAggregationChange}
            availableAggregations={availableAggregations}
            baseline={baseline}
            dateRangeValue={dateRangeValue}
            onDateRangeChange={handleDateRangeChange}
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
