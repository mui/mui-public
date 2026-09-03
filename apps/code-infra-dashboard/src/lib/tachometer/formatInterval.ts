import type { ConfidenceInterval } from './types';

/**
 * How a tachometer report's numbers are written, shared by the pull request comment and the details
 * page so the two never disagree about precision.
 */

/** `20.50 – 22.67 ms`, with the unit written once. */
export function formatMean(interval: ConfidenceInterval): string {
  return `${interval.low.toFixed(2)} – ${interval.high.toFixed(2)} ms`;
}

/** `+2.7% – +6.8%`, both bounds signed so the direction reads without the verdict. */
export function formatPercent(interval: ConfidenceInterval): string {
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  return `${signed(interval.low)} – ${signed(interval.high)}`;
}

/** Kibibytes, matching how tachometer's own table reports `bytesSent`. */
export function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
