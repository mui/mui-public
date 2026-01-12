'use client';

import * as React from 'react';
import { useQueries, UseQueryResult } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import { DateRangePicker } from '@mui/x-date-pickers-pro/DateRangePicker';
import { DateRange } from '@mui/x-date-pickers-pro/models';
import { PickersShortcutsItem } from '@mui/x-date-pickers-pro';
import dayjs, { Dayjs } from 'dayjs';
import { useSearchParamState, CODEC_STRING_ARRAY, CODEC_DAYJS } from '../hooks/useSearchParamState';
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

const shortcutsItems: PickersShortcutsItem<DateRange<Dayjs>>[] = [
  {
    label: 'Last 10 Years',
    getValue: () => {
      const today = dayjs();
      return [today.subtract(10, 'year'), today];
    },
  },
  {
    label: 'Last 5 Years',
    getValue: () => {
      const today = dayjs();
      return [today.subtract(5, 'year'), today];
    },
  },
  {
    label: 'Last 3 Years',
    getValue: () => {
      const today = dayjs();
      return [today.subtract(3, 'year'), today];
    },
  },
  {
    label: 'Last Year',
    getValue: () => {
      const today = dayjs();
      return [today.subtract(1, 'year'), today];
    },
  },
  {
    label: 'Year to Date',
    getValue: () => {
      const today = dayjs();
      return [today.startOf('year'), today];
    },
  },
  {
    label: 'Last 3 Months',
    getValue: () => {
      const today = dayjs();
      return [today.subtract(3, 'month'), today];
    },
  },
  {
    label: 'Last 30 Days',
    getValue: () => {
      const today = dayjs();
      return [today.subtract(30, 'day'), today];
    },
  },
  {
    label: 'Last 7 Days',
    getValue: () => {
      const today = dayjs();
      return [today.subtract(7, 'day'), today];
    },
  },
];

export default function NpmDownloads() {
  const defaultRange = React.useMemo(() => getDefaultDateRange(), []);

  // URL params with useSearchParamState
  const [selectedPackages, setSelectedPackages] = useSearchParamState({
    key: 'packages',
    defaultValue: [] as string[],
    ...CODEC_STRING_ARRAY,
  });

  const [fromDate, setFromDate] = useSearchParamState({
    key: 'from',
    defaultValue: dayjs(defaultRange.from),
    ...CODEC_DAYJS,
  });

  const [untilDate, setUntilDate] = useSearchParamState({
    key: 'until',
    defaultValue: dayjs(defaultRange.until),
    ...CODEC_DAYJS,
  });

  const [aggregationParam, setAggregationParam] = useSearchParamState({
    key: 'aggregation',
    defaultValue: '',
  });

  const [baselineParam, setBaselineParam] = useSearchParamState({
    key: 'baseline',
    defaultValue: '',
  });

  const dateRangeValue = React.useMemo<DateRange<Dayjs>>(
    () => [fromDate, untilDate],
    [fromDate, untilDate],
  );

  const availableAggregations = React.useMemo(
    () => getAvailableAggregations(fromDate.toDate(), untilDate.toDate()),
    [fromDate, untilDate],
  );

  const aggregation = React.useMemo(() => {
    if (aggregationParam && availableAggregations.includes(aggregationParam as AggregationPeriod)) {
      return aggregationParam as AggregationPeriod;
    }
    return getDefaultAggregation(fromDate.toDate(), untilDate.toDate());
  }, [aggregationParam, availableAggregations, fromDate, untilDate]);

  const baseline = React.useMemo(
    () => (baselineParam && selectedPackages.includes(baselineParam) ? baselineParam : null),
    [baselineParam, selectedPackages],
  );

  // Fetch downloads data - one query per package for individual caching
  const packageQueries = useQueries({
    queries: selectedPackages.map((pkg) => ({
      queryKey: ['npmDownloads', pkg, fromDate.toISOString(), untilDate.toISOString()],
      queryFn: () => fetchPackageExpression(pkg, fromDate.toDate(), untilDate.toDate()),
      staleTime: 10 * 60 * 1000,
    })),
  });

  // Create an object of package -> query result for easy access
  const queryByPackage = React.useMemo(
    () => Object.fromEntries(selectedPackages.map((pkg, i) => [pkg, packageQueries[i]])),
    [selectedPackages, packageQueries],
  );

  const handleAddPackage = React.useCallback(
    (packageName: string) => {
      if (selectedPackages.includes(packageName)) {
        return;
      }
      setSelectedPackages([...selectedPackages, packageName]);
    },
    [selectedPackages, setSelectedPackages],
  );

  const handleRemovePackage = React.useCallback(
    (packageName: string) => {
      const packages = selectedPackages.filter((p) => p !== packageName);

      // Clear baseline if removed package was the baseline
      if (baselineParam === packageName || packages.length === 0) {
        setBaselineParam('');
      }

      setSelectedPackages(packages);
    },
    [selectedPackages, setSelectedPackages, baselineParam, setBaselineParam],
  );

  const handleDateRangeChange = React.useCallback(
    (newValue: DateRange<Dayjs>) => {
      const [newFrom, newUntil] = newValue;
      if (newFrom?.isValid()) {
        setFromDate(newFrom);
      }
      if (newUntil?.isValid()) {
        setUntilDate(newUntil);
      }
    },
    [setFromDate, setUntilDate],
  );

  const handleAggregationChange = React.useCallback(
    (newAggregation: AggregationPeriod) => {
      setAggregationParam(newAggregation);
    },
    [setAggregationParam],
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
              shortcuts: {
                items: shortcutsItems,
              },
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
