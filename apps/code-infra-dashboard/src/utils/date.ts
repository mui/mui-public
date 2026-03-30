const RELATIVE_TIME_UNITS: Array<{
  max: number;
  divisor: number;
  unit: Intl.RelativeTimeFormatUnit;
}> = [
  { max: 60, divisor: 1, unit: 'second' },
  { max: 3600, divisor: 60, unit: 'minute' },
  { max: 86400, divisor: 3600, unit: 'hour' },
  { max: 604800, divisor: 86400, unit: 'day' },
  { max: 2592000, divisor: 604800, unit: 'week' },
  { max: 31536000, divisor: 2592000, unit: 'month' },
];

export function formatRelativeTime(ts: number): string {
  const diffSecs = Math.round((ts - Date.now()) / 1000);
  const absDiff = Math.abs(diffSecs);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  for (const { max, divisor, unit } of RELATIVE_TIME_UNITS) {
    if (absDiff < max) {
      return rtf.format(Math.round(diffSecs / divisor), unit);
    }
  }
  return rtf.format(Math.round(diffSecs / 31536000), 'year');
}
