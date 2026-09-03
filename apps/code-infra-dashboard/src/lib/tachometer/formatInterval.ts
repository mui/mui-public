import type { ConfidenceInterval } from './types';

/**
 * How a tachometer report's numbers are written, shared by the pull request comment and the details
 * page so the two never disagree about precision.
 */

/** `20.50 – 22.67 ms`, with the unit written once. */
export function formatMean(interval: ConfidenceInterval): string {
  return `${interval.low.toFixed(2)} – ${interval.high.toFixed(2)} ms`;
}

/** Both bounds signed, so the direction of a difference reads without the verdict beside it. */
function signedInterval(interval: ConfidenceInterval, unit: string, digits: number): string {
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}${unit}`;
  return `${signed(interval.low)} – ${signed(interval.high)}`;
}

/** `+2.7% – +6.8%`. */
export function formatPercent(interval: ConfidenceInterval): string {
  return signedInterval(interval, '%', 1);
}

/** `+6.10 ms – +15.20 ms`. Only a regression line states an absolute difference. */
export function formatSignedMs(interval: ConfidenceInterval): string {
  return signedInterval(interval, ' ms', 2);
}

/** Kibibytes, matching how tachometer's own table reports `bytesSent`. */
export function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
