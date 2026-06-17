import { describe, it, expect } from 'vitest';
import { migrateBenchmarkReport } from './migrateBenchmarkReport';
import type { BenchmarkReport } from './types';

function report(metrics: Record<string, number>): BenchmarkReport {
  return {
    Bench: {
      iterations: 10,
      totalDuration: 0,
      renders: [],
      metrics: Object.fromEntries(
        Object.entries(metrics).map(([name, mean]) => [name, { mean, stdDev: 0, outliers: 0 }]),
      ),
    },
  };
}

describe('migrateBenchmarkReport', () => {
  it('renames legacy paint:default to bench:paint', () => {
    const migrated = migrateBenchmarkReport(report({ 'paint:default': 12 }));
    expect(Object.keys(migrated.Bench.metrics)).toEqual(['bench:paint']);
    expect(migrated.Bench.metrics['bench:paint'].mean).toBe(12);
  });

  it('renames named legacy paint keys to bench:paint sub-series', () => {
    const migrated = migrateBenchmarkReport(report({ 'paint:grid-header': 8 }));
    expect(Object.keys(migrated.Bench.metrics)).toEqual(['bench:paint#grid-header']);
  });

  it('leaves current and custom metric keys untouched (idempotent)', () => {
    const migrated = migrateBenchmarkReport(
      report({ 'bench:paint': 5, 'bench:paint#header': 3, button_clicks: 2 }),
    );
    expect(Object.keys(migrated.Bench.metrics).sort()).toEqual([
      'bench:paint',
      'bench:paint#header',
      'button_clicks',
    ]);
  });
});
