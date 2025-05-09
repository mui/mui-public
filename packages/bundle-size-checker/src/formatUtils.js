/**
 * Format utilities for consistent display of sizes and percentages
 */

// Formatter for byte sizes (absolute values) - no sign
export const byteSizeFormatter = new Intl.NumberFormat(undefined, {
  style: 'unit',
  unit: 'byte',
  notation: 'compact',
  unitDisplay: 'narrow',
  maximumSignificantDigits: 3,
  minimumSignificantDigits: 1,
});

// Formatter for size changes - always show sign
export const byteSizeChangeFormatter = new Intl.NumberFormat(undefined, {
  ...byteSizeFormatter.resolvedOptions(),
  signDisplay: 'exceptZero',
});

// Formatter for percentage display
export const displayPercentFormatter = new Intl.NumberFormat(undefined, {
  style: 'percent',
  signDisplay: 'exceptZero',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});
