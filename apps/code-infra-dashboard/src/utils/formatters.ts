const durationFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const percentFormatter = new Intl.NumberFormat(undefined, {
  style: 'percent',
  signDisplay: 'exceptZero',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatMs(value: number | null): string {
  if (value === null) {
    return 'No data';
  }
  return `${durationFormatter.format(value)} ms`;
}

export function formatDiffMs(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${durationFormatter.format(value)} ms`;
}

// `Intl.NumberFormat` construction is comparatively expensive, so cache one instance per unique
// format spec — these formatters run for every metric cell on every render.
const numberFormatterCache = new Map<string, Intl.NumberFormat>();

function getNumberFormatter(format: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(format);
  let formatter = numberFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, format);
    numberFormatterCache.set(key, formatter);
  }
  return formatter;
}

/** Formats a metric value with its `Intl.NumberFormatOptions`, falling back to milliseconds. */
export function formatMetricNumber(value: number, format?: Intl.NumberFormatOptions): string {
  return format ? getNumberFormatter(format).format(value) : formatMs(value);
}

/** Formats a signed metric diff with its format, falling back to a millisecond diff. */
export function formatMetricDiff(value: number, format?: Intl.NumberFormatOptions): string {
  // `signDisplay` is spread last so a diff always shows its sign, regardless of the metric's format.
  return format
    ? getNumberFormatter({ ...format, signDisplay: 'exceptZero' }).format(value)
    : formatDiffMs(value);
}

/** Compact p-value label, e.g. `p=0.031` or `p<0.001` for values too small to show at 3 decimals. */
export function formatPValue(pValue: number): string {
  return pValue < 0.001 ? 'p<0.001' : `p=${pValue.toFixed(3)}`;
}

interface ColumnDefinition {
  field: string;
  header?: string;
  align?: 'left' | 'center' | 'right';
}

export function formatMarkdownTable(
  columns: ColumnDefinition[],
  data: Partial<Record<string, unknown>>[],
): string {
  let table = '';

  const headers = columns.map((col) => col.header || col.field);
  const alignments = columns.map((col) => col.align || 'left');

  table += `| ${headers.join(' | ')} |\n`;

  const separators = alignments.map((align) => {
    switch (align) {
      case 'center':
        return ':---------:';
      case 'right':
        return '----------:';
      case 'left':
        return ':----------';
      default:
        return '-----------';
    }
  });
  table += `|${separators.join('|')}|\n`;

  data.forEach((row) => {
    const cells = columns.map((col) => row[col.field] ?? '');
    table += `| ${cells.join(' | ')} |\n`;
  });

  return table;
}
