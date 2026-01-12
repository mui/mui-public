'use client';

import * as React from 'react';
import Link from 'next/link';
import { UseQueryResult } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Alert from '@mui/material/Alert';
import Skeleton from '@mui/material/Skeleton';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TablePagination from '@mui/material/TablePagination';
import MuiLink from '@mui/material/Link';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import AnchorIcon from '@mui/icons-material/Anchor';
import CloseIcon from '@mui/icons-material/Close';
import {
  LineChart,
  AnimatedLineProps,
  HighlightItemData,
  AxisValueFormatterContext,
} from '@mui/x-charts';
import { useEventCallback } from '@mui/material/utils';
import { NpmDownloadsData, processDownloadsData, AggregationPeriod } from '../lib/npmDownloads';
import { NpmDownloadsLink } from './NpmDownloadsLink';

const COLORS = [
  '#ea5545',
  '#f46a9b',
  '#ef9b20',
  '#edbf33',
  '#ede15b',
  '#bdcf32',
  '#87bc45',
  '#27aeef',
  '#b33dc6',
];

// Date formatters
const tickDateFormat = new Intl.DateTimeFormat(undefined, {
  month: '2-digit',
  day: '2-digit',
});
const mediumDateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
});

// Number formatters
const compactNumberFormat = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  compactDisplay: 'short',
});
const percentFormat = new Intl.NumberFormat(undefined, {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const integerFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

// HoverStore for synchronized hover state
class HoverStore {
  private hoveredIndex: number | null = null;

  private listeners = new Set<() => void>();

  subscribe = (callback: () => void): (() => void) => {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  };

  getSnapshot = (): number | null => this.hoveredIndex;

  setHoveredIndex = (index: number | null): void => {
    this.hoveredIndex = index;
    this.listeners.forEach((callback) => callback());
  };
}

// CustomLine for better hover interaction
function CustomLine(props: AnimatedLineProps) {
  const { d, ownerState, className, ...other } = props;

  return (
    <React.Fragment>
      <path
        d={d}
        stroke={ownerState.gradientId ? `url(#${ownerState.gradientId})` : ownerState.color}
        strokeWidth={ownerState.isHighlighted ? 4 : 2}
        strokeLinejoin="round"
        fill="none"
        filter={ownerState.isHighlighted ? 'brightness(120%)' : undefined}
        opacity={ownerState.isFaded ? 0.3 : 1}
        className={className}
      />
      <path
        d={d}
        stroke="transparent"
        strokeWidth={25}
        fill="none"
        className="interaction-area"
        {...other}
      />
    </React.Fragment>
  );
}

function dateValueFormatter(date: Date, ctx: AxisValueFormatterContext): string {
  if (ctx.location === 'tick') {
    return tickDateFormat.format(date);
  }
  return mediumDateFormat.format(date);
}

function downloadsValueFormatter(value: number) {
  return compactNumberFormat.format(value);
}

function percentageValueFormatter(value: number) {
  return percentFormat.format(value / 100);
}

function formatTableNumber(n: number): string {
  return integerFormat.format(n);
}

function formatDownloadValue(value: number, isRelative: boolean): string {
  return isRelative ? percentageValueFormatter(value) : formatTableNumber(value);
}

function renderCellContent(
  isLoading: boolean,
  isError: boolean,
  downloads: number | undefined,
  isRelativeMode: boolean,
): React.ReactNode {
  if (isLoading) {
    return <Skeleton width={50} height={16} />;
  }
  if (isError) {
    return (
      <Typography variant="caption" color="error">
        Error
      </Typography>
    );
  }
  if (downloads !== undefined) {
    return formatDownloadValue(downloads, isRelativeMode);
  }
  return '-';
}

// Package Cards subcomponent
interface PackageCardsProps {
  packages: string[];
  queryByPackage: Record<string, UseQueryResult<NpmDownloadsData, Error>>;
  processedData: ReturnType<typeof processDownloadsData> | null;
  baseline: string | null;
  isRelativeMode: boolean;
  hoverStore: HoverStore;
  hiddenPackages: Set<string>;
  onToggleVisibility: (pkg: string) => void;
  onRemove: (pkg: string) => void;
}

const PackageCards = React.memo(function PackageCards({
  packages,
  queryByPackage,
  processedData,
  baseline,
  isRelativeMode,
  hoverStore,
  hiddenPackages,
  onToggleVisibility,
  onRemove,
}: PackageCardsProps) {
  const hoveredIndex = React.useSyncExternalStore(
    hoverStore.subscribe,
    hoverStore.getSnapshot,
    hoverStore.getSnapshot,
  );

  return (
    <Grid container spacing={1.5}>
      {packages.map((pkg, index) => {
        const query = queryByPackage[pkg];
        const total = processedData?.totalsByPackage.get(pkg);
        const isBaseline = baseline === pkg;
        const isHovered = hoveredIndex === index;
        const isHidden = hiddenPackages.has(pkg);
        const isLoading = query?.isPending ?? true;
        const isError = query?.isError ?? false;

        return (
          <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={pkg}>
            <Card
              onMouseEnter={() => hoverStore.setHoveredIndex(index)}
              onMouseLeave={() => hoverStore.setHoveredIndex(null)}
              sx={{
                height: '100%',
                borderLeft: 3,
                borderColor: COLORS[index % COLORS.length],
                backgroundColor: isHovered ? 'action.hover' : 'background.paper',
                opacity: isHidden ? 0.5 : 1,
                transition: 'background-color 0.2s, opacity 0.2s',
              }}
            >
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 0.5,
                  }}
                >
                  <MuiLink
                    component={Link}
                    href={`/npm-versions?package=${encodeURIComponent(pkg)}`}
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {pkg}
                  </MuiLink>
                  <Box sx={{ display: 'flex', flexShrink: 0 }}>
                    <Tooltip title={isHidden ? 'Show in chart' : 'Hide from chart'}>
                      <IconButton
                        size="small"
                        onClick={() => onToggleVisibility(pkg)}
                        sx={{ p: 0.25 }}
                      >
                        {isHidden ? (
                          <VisibilityOffIcon sx={{ fontSize: 16 }} />
                        ) : (
                          <VisibilityIcon sx={{ fontSize: 16 }} />
                        )}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={isBaseline ? 'Clear baseline' : 'Set as baseline'}>
                      <IconButton
                        component={NpmDownloadsLink}
                        baseline={isBaseline ? null : pkg}
                        size="small"
                        sx={{ p: 0.25 }}
                      >
                        <AnchorIcon
                          sx={{ fontSize: 16 }}
                          color={isBaseline ? 'primary' : 'inherit'}
                        />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Remove">
                      <IconButton size="small" onClick={() => onRemove(pkg)} sx={{ p: 0.25 }}>
                        <CloseIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
                <Box sx={{ mt: 0.5 }}>
                  {isLoading && <Skeleton width={60} height={20} />}
                  {isError && (
                    <Typography variant="caption" color="error">
                      Failed to load
                    </Typography>
                  )}
                  {!isLoading && !isError && (
                    <Typography variant="subtitle2">
                      {isRelativeMode
                        ? percentageValueFormatter(total || 0)
                        : downloadsValueFormatter(total || 0)}
                    </Typography>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
});

// Line Chart subcomponent
interface DownloadsLineChartProps {
  processedData: ReturnType<typeof processDownloadsData> | null;
  packages: string[];
  visiblePackages: string[];
  queryByPackage: Record<string, UseQueryResult<NpmDownloadsData, Error>>;
  hoverStore: HoverStore;
  isRelativeMode: boolean;
}

const DownloadsLineChart = React.memo(function DownloadsLineChart({
  processedData,
  packages,
  visiblePackages,
  queryByPackage,
  hoverStore,
  isRelativeMode,
}: DownloadsLineChartProps) {
  const hoveredIndex = React.useSyncExternalStore(
    hoverStore.subscribe,
    hoverStore.getSnapshot,
    hoverStore.getSnapshot,
  );

  const handleHighlightChange = useEventCallback((item: HighlightItemData | null) => {
    const index = packages.findIndex((pkg) => pkg === item?.seriesId);
    hoverStore.setHoveredIndex(index < 0 ? null : index);
  });

  // Only show series for visible packages that have loaded data
  const series = React.useMemo(() => {
    if (!processedData) {
      return [];
    }
    return visiblePackages
      .filter((pkg) => {
        const query = queryByPackage[pkg];
        return query?.data && processedData.downloadsByPackage.has(pkg);
      })
      .map((pkg) => {
        const index = packages.indexOf(pkg);
        return {
          id: pkg,
          label: pkg,
          data: processedData.downloadsByPackage.get(pkg) || [],
          color: COLORS[index % COLORS.length],
          highlightScope: { fade: 'global' as const, highlight: 'series' as const },
          valueFormatter: (value: number | null) => {
            if (value === null) {
              return 'No data';
            }
            return isRelativeMode
              ? percentageValueFormatter(value)
              : downloadsValueFormatter(value);
          },
          showMark: false,
        };
      });
  }, [processedData, packages, visiblePackages, queryByPackage, isRelativeMode]);

  // Check if any data is loading
  const isAnyLoading = Object.values(queryByPackage).some((q) => q.isPending);

  if (!processedData || (series.length === 0 && isAnyLoading)) {
    return <Skeleton variant="rectangular" height={400} />;
  }

  if (series.length === 0) {
    return (
      <Alert severity="info">
        No data to display. Make sure at least one package is visible and has loaded data.
      </Alert>
    );
  }

  return (
    <LineChart
      series={series}
      xAxis={[
        {
          data: processedData.dates,
          scaleType: 'time',
          valueFormatter: dateValueFormatter,
          tickMinStep: 3600 * 1000 * 24 * 7,
        },
      ]}
      yAxis={[
        {
          label: isRelativeMode ? 'Percentage' : 'Downloads',
          valueFormatter: isRelativeMode ? percentageValueFormatter : downloadsValueFormatter,
        },
      ]}
      height={400}
      highlightedItem={hoveredIndex !== null ? { seriesId: packages[hoveredIndex] } : null}
      onHighlightChange={handleHighlightChange}
      slots={{ line: CustomLine }}
    />
  );
});

// Table subcomponent
interface DownloadsTableProps {
  processedData: ReturnType<typeof processDownloadsData> | null;
  packages: string[];
  queryByPackage: Record<string, UseQueryResult<NpmDownloadsData, Error>>;
  hoverStore: HoverStore;
  isRelativeMode: boolean;
}

const DownloadsTable = React.memo(function DownloadsTable({
  processedData,
  packages,
  queryByPackage,
  hoverStore,
  isRelativeMode,
}: DownloadsTableProps) {
  const hoveredIndex = React.useSyncExternalStore(
    hoverStore.subscribe,
    hoverStore.getSnapshot,
    hoverStore.getSnapshot,
  );
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(10);

  // Reset page when data changes
  React.useEffect(() => {
    setPage(0);
  }, [processedData?.dates.length]);

  // Check if all queries are loading
  const isAllLoading =
    packages.length > 0 && Object.values(queryByPackage).every((q) => q.isPending);

  if (isAllLoading) {
    return (
      <Box>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} height={40} sx={{ mb: 1 }} />
        ))}
      </Box>
    );
  }

  if (!processedData) {
    return <Alert severity="info">No data available yet.</Alert>;
  }

  // Show most recent dates first
  const reversedDates = [...processedData.dates].reverse();
  const paginatedDates = reversedDates.slice(page * rowsPerPage, (page + 1) * rowsPerPage);

  return (
    <Box>
      <TableContainer sx={{ maxHeight: 500 }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              {packages.map((pkg, index) => {
                const query = queryByPackage[pkg];
                const isLoading = query?.isPending ?? true;
                const isError = query?.isError ?? false;

                return (
                  <TableCell
                    key={pkg}
                    align="right"
                    onMouseEnter={() => hoverStore.setHoveredIndex(index)}
                    onMouseLeave={() => hoverStore.setHoveredIndex(null)}
                    sx={{
                      backgroundColor: hoveredIndex === index ? 'action.hover' : 'background.paper',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s',
                    }}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: 1,
                      }}
                    >
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          backgroundColor: COLORS[index % COLORS.length],
                          flexShrink: 0,
                        }}
                      />
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 'bold',
                          maxWidth: 120,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={pkg}
                      >
                        {pkg}
                      </Typography>
                      {isLoading && <Skeleton width={20} height={16} sx={{ ml: 0.5 }} />}
                      {isError && (
                        <Typography variant="caption" color="error" sx={{ ml: 0.5 }}>
                          !
                        </Typography>
                      )}
                    </Box>
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedDates.map((date) => {
              const originalIndex = processedData.dates.findIndex(
                (d) => d.getTime() === date.getTime(),
              );
              return (
                <TableRow key={date.toISOString()} hover>
                  <TableCell>{mediumDateFormat.format(date)}</TableCell>
                  {packages.map((pkg, pkgIndex) => {
                    const query = queryByPackage[pkg];
                    const isLoading = query?.isPending ?? true;
                    const isError = query?.isError ?? false;
                    const downloads = processedData.downloadsByPackage.get(pkg)?.[originalIndex];

                    return (
                      <TableCell
                        key={pkg}
                        align="right"
                        onMouseEnter={() => hoverStore.setHoveredIndex(pkgIndex)}
                        onMouseLeave={() => hoverStore.setHoveredIndex(null)}
                        sx={{
                          backgroundColor:
                            hoveredIndex === pkgIndex ? 'action.hover' : 'transparent',
                          transition: 'background-color 0.2s',
                        }}
                      >
                        {renderCellContent(isLoading, isError, downloads, isRelativeMode)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={reversedDates.length}
        page={page}
        onPageChange={(_event, newPage) => setPage(newPage)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(event) => {
          setRowsPerPage(parseInt(event.target.value, 10));
          setPage(0);
        }}
        rowsPerPageOptions={[10, 25, 50]}
      />
    </Box>
  );
});

interface NpmDownloadsChartProps {
  queryByPackage: Record<string, UseQueryResult<NpmDownloadsData, Error>>;
  aggregation: AggregationPeriod;
  onAggregationChange: (aggregation: AggregationPeriod) => void;
  availableAggregations: AggregationPeriod[];
  baseline: string | null;
  onRemove: (pkg: string) => void;
}

export default function NpmDownloadsChart({
  queryByPackage,
  aggregation,
  onAggregationChange,
  availableAggregations,
  baseline,
  onRemove,
}: NpmDownloadsChartProps) {
  const expressions = React.useMemo(() => Object.keys(queryByPackage), [queryByPackage]);
  const [hoverStore] = React.useState(() => new HoverStore());
  const [hiddenPackages, setHiddenPackages] = React.useState<Set<string>>(new Set());

  const toggleVisibility = React.useCallback((pkg: string) => {
    setHiddenPackages((prev) => {
      const next = new Set(prev);
      if (next.has(pkg)) {
        next.delete(pkg);
      } else {
        next.add(pkg);
      }
      return next;
    });
  }, []);

  // Process data for visualization
  const processedData = React.useMemo(() => {
    const combinedData = Object.values(queryByPackage).reduce<NpmDownloadsData>((acc, query) => {
      if (query.data) {
        Object.assign(acc, query.data);
      }
      return acc;
    }, {});
    return processDownloadsData(expressions, combinedData, aggregation, baseline);
  }, [expressions, queryByPackage, aggregation, baseline]);

  // Get visible packages (not hidden and has data)
  const visiblePackages = React.useMemo(
    () => expressions.filter((pkg) => !hiddenPackages.has(pkg)),
    [expressions, hiddenPackages],
  );

  const isRelativeMode = baseline !== null;

  return (
    <Box>
      {/* Package Cards */}
      <Typography variant="h3" sx={{ mb: 2 }}>
        Package Summary
      </Typography>
      <PackageCards
        packages={expressions}
        queryByPackage={queryByPackage}
        processedData={processedData}
        baseline={baseline}
        isRelativeMode={isRelativeMode}
        hoverStore={hoverStore}
        hiddenPackages={hiddenPackages}
        onToggleVisibility={toggleVisibility}
        onRemove={onRemove}
      />

      {/* Controls */}
      <Box sx={{ mt: 3, mb: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2">Aggregate by:</Typography>
          <ToggleButtonGroup
            value={aggregation}
            exclusive
            onChange={(_event, value) => value && onAggregationChange(value)}
            size="small"
          >
            <ToggleButton value="daily" disabled={!availableAggregations.includes('daily')}>
              Daily
            </ToggleButton>
            <ToggleButton value="weekly" disabled={!availableAggregations.includes('weekly')}>
              Weekly
            </ToggleButton>
            <ToggleButton value="monthly" disabled={!availableAggregations.includes('monthly')}>
              Monthly
            </ToggleButton>
            <ToggleButton value="yearly" disabled={!availableAggregations.includes('yearly')}>
              Yearly
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {baseline && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" color="primary">
              Relative to: <strong>{baseline}</strong>
            </Typography>
            <MuiLink component={NpmDownloadsLink} baseline={null} variant="body2">
              Clear
            </MuiLink>
          </Box>
        )}
      </Box>

      {/* Line Chart */}
      <Typography variant="h3" sx={{ mt: 3, mb: 2 }}>
        Download Trends
      </Typography>
      <DownloadsLineChart
        processedData={processedData}
        packages={expressions}
        visiblePackages={visiblePackages}
        queryByPackage={queryByPackage}
        hoverStore={hoverStore}
        isRelativeMode={isRelativeMode}
      />

      {/* Comparison Table */}
      <Typography variant="h3" sx={{ mt: 3, mb: 2 }}>
        Downloads Comparison
      </Typography>
      <DownloadsTable
        processedData={processedData}
        packages={expressions}
        queryByPackage={queryByPackage}
        hoverStore={hoverStore}
        isRelativeMode={isRelativeMode}
      />
    </Box>
  );
}
