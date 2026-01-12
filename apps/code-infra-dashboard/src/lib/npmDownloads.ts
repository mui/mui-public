import { fetchJson } from '../utils/http';

// Types
export interface NpmDownloadsData {
  [packageName: string]: {
    [date: string]: number;
  };
}

export type AggregationPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface ProcessedDownloadsData {
  packages: string[];
  dates: Date[];
  downloadsByPackage: Map<string, (number | null)[]>;
  totalsByPackage: Map<string, number>;
}

export interface DownloadsPreset {
  name: string;
  packages: string[];
}

// Presets
export const DOWNLOADS_PRESETS: DownloadsPreset[] = [
  {
    name: 'Headless Libraries',
    packages: [
      '@base-ui/react',
      '@mui/base',
      '@react-aria/utils',
      '@headlessui/react',
      'reakit',
      '@radix-ui/react-primitive',
      '@reach/utils',
    ],
  },
  {
    name: 'MUI Core',
    packages: ['@mui/material', '@mui/system', '@mui/styled-engine', '@mui/utils'],
  },
  {
    name: 'MUI X',
    packages: ['@mui/x-data-grid', '@mui/x-date-pickers', '@mui/x-charts', '@mui/x-tree-view'],
  },
  {
    name: 'React UI Libraries',
    packages: ['@mui/material', '@chakra-ui/react', '@mantine/core', 'antd'],
  },
];

// Helper to format date as YYYY-MM-DD
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get the start of a period (week starts on Monday)
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getYearStart(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1);
}

// make sure to handle whitespace correctly
function parsePackageExpression(expression: string): string[] {
  return expression
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
}

// Fetch downloads from npm-stat.com
export async function fetchPackageExpression(
  expression: string,
  from: Date,
  until: Date,
): Promise<NpmDownloadsData> {
  const fromStr = formatDate(from);
  const untilStr = formatDate(until);

  const params = new URLSearchParams();

  const packages = parsePackageExpression(expression);

  for (const pkg of packages) {
    params.append('package', pkg);
  }

  params.set('from', fromStr);
  params.set('until', untilStr);

  return fetchJson<NpmDownloadsData>(`/api/npm-downloads?${params.toString()}`);
}

// Get available aggregations based on date range
export function getAvailableAggregations(from: Date, until: Date): AggregationPeriod[] {
  const diffMs = until.getTime() - from.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  const available: AggregationPeriod[] = ['daily'];

  if (diffDays >= 14) {
    available.push('weekly');
  }
  if (diffDays >= 60) {
    available.push('monthly');
  }
  if (diffDays >= 730) {
    available.push('yearly');
  }

  return available;
}

// Get smart default aggregation based on date range
export function getDefaultAggregation(from: Date, until: Date): AggregationPeriod {
  const diffMs = until.getTime() - from.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays >= 730) {
    return 'monthly';
  }
  if (diffDays >= 180) {
    return 'monthly';
  }
  if (diffDays >= 30) {
    return 'weekly';
  }
  return 'daily';
}

// Process and aggregate raw data
export function processDownloadsData(
  expressions: string[],
  rawData: NpmDownloadsData,
  aggregation: AggregationPeriod = 'weekly',
  baseline: string | null = null,
): ProcessedDownloadsData {
  const packages = Object.keys(rawData);

  // Get all unique dates from all packages
  const allDatesSet = new Set<string>();
  for (const pkg of packages) {
    for (const date of Object.keys(rawData[pkg])) {
      allDatesSet.add(date);
    }
  }

  const allDates = Array.from(allDatesSet).sort();

  // Aggregate based on period
  const aggregatedData: Map<string, Map<string, number>> = new Map();
  const totalsByPackage: Map<string, number> = new Map();

  for (const expression of expressions) {
    const pkgs = parsePackageExpression(expression);

    aggregatedData.set(expression, new Map());

    if (!pkgs.every((p) => rawData.hasOwnProperty(p))) {
      continue;
    }

    for (const dateStr of allDates) {
      const date = new Date(dateStr);

      let periodKey: string;
      switch (aggregation) {
        case 'weekly':
          periodKey = formatDate(getWeekStart(date));
          break;
        case 'monthly':
          periodKey = formatDate(getMonthStart(date));
          break;
        case 'yearly':
          periodKey = formatDate(getYearStart(date));
          break;
        default:
          periodKey = dateStr;
      }

      for (const pkg of pkgs) {
        const downloads = rawData[pkg][dateStr] || 0;
        const pkgData = aggregatedData.get(expression)!;
        pkgData.set(periodKey, (pkgData.get(periodKey) || 0) + downloads);
        totalsByPackage.set(expression, (totalsByPackage.get(expression) || 0) + downloads);
      }
    }
  }

  // Get unique period keys and sort them
  const periodKeysSet = new Set<string>();
  for (const pkgData of aggregatedData.values()) {
    for (const key of pkgData.keys()) {
      periodKeysSet.add(key);
    }
  }
  const periodKeys = Array.from(periodKeysSet).sort();

  // Convert to arrays
  const dates = periodKeys.map((key) => new Date(key));
  const downloadsByPackage: Map<string, (number | null)[]> = new Map();

  for (const expression of expressions) {
    const pkgData = aggregatedData.get(expression)!;
    const downloads = periodKeys.map((key) => pkgData.get(key) || 0);
    downloadsByPackage.set(expression, downloads);
  }

  // Apply relative transformation if baseline is set
  if (baseline) {
    const baselineDownloads = downloadsByPackage.get(baseline);
    if (baselineDownloads) {
      const baselineTotal = totalsByPackage.get(baseline) || 1;

      for (const expression of expressions) {
        const downloads = downloadsByPackage.get(expression)!;
        const relativeDownloads = downloads.map((d, i) => {
          const baselineValue = baselineDownloads[i];
          if (baselineValue === 0) {
            return null;
          }
          return (d / baselineValue) * 100;
        });
        downloadsByPackage.set(expression, relativeDownloads);

        const total = totalsByPackage.get(expression) || 0;
        totalsByPackage.set(expression, (total / baselineTotal) * 100);
      }
    }
  }

  return {
    packages,
    dates,
    downloadsByPackage,
    totalsByPackage,
  };
}

// Default date range (3 years ago to today)
export function getDefaultDateRange(): { from: Date; until: Date } {
  const until = new Date();
  const from = new Date();
  from.setFullYear(from.getFullYear() - 3);
  return { from, until };
}
