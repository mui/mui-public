import { describe, expect, it } from 'vitest';
import { analyzeBenchmark } from './runReport/analyzeRun';
import type { RunBenchmark, RunMetricDefinition } from './runReport';
import { DEFAULT_SAMPLING, differencesResolved, isResolved, resolveSampling } from './sampling';

describe('isResolved', () => {
  it('is resolved when the interval lies on one side of every horizon', () => {
    expect(isResolved({ low: 2, high: 8 }, [0])).toBe(true);
    expect(isResolved({ low: -8, high: -2 }, [0])).toBe(true);
    expect(isResolved({ low: -4, high: 4 }, [-10, 10])).toBe(true);
  });

  it('is unresolved while the interval straddles a horizon', () => {
    expect(isResolved({ low: -1, high: 3 }, [0])).toBe(false);
    expect(isResolved({ low: 5, high: 15 }, [-10, 10])).toBe(false);
  });

  it('treats an exact, zero-width difference as resolved', () => {
    expect(isResolved({ low: 0, high: 0 }, [0])).toBe(true);
  });
});

describe('resolveSampling', () => {
  it('fills in a default for every option left out or undefined', () => {
    expect(resolveSampling({ timeout: 1, sampleSize: undefined })).toEqual({
      ...DEFAULT_SAMPLING,
      timeout: 1,
    });
  });

  it('accepts the documented ranges', () => {
    expect(() => resolveSampling({ sampleSize: 2, timeout: 0 })).not.toThrow();
  });

  it('rejects a sample size that cannot form an interval', () => {
    expect(() => resolveSampling({ sampleSize: 1 })).toThrow(/Invalid sampleSize 1/);
    expect(() => resolveSampling({ sampleSize: 2.5 })).toThrow(/Invalid sampleSize 2.5/);
  });

  it('rejects a negative timeout', () => {
    expect(() => resolveSampling({ timeout: -1 })).toThrow(/Invalid timeout -1/);
  });
});

describe('differencesResolved', () => {
  const noisy = [10, 12, 9, 11, 10, 13, 8, 11];
  const clearlySlower = noisy.map((value) => value * 2);
  const sameish = [11, 9, 10, 12, 11, 10, 9, 12];

  /** A current-vs-baseline benchmark; `paint` follows `render` unless given. */
  function benchmarkOf(
    render: { current: number[]; baseline: number[] },
    paint = render,
  ): RunBenchmark {
    return {
      name: 'mount',
      file: 'button.bench.tsx',
      kind: 'baseline',
      variants: ['current', 'baseline'],
      samples: {
        current: { render: render.current, paint: paint.current },
        baseline: { render: render.baseline, paint: paint.baseline },
      },
    };
  }

  const alarmedRender: Record<string, RunMetricDefinition> = {
    render: { kind: 'scalar', alarm: {} },
    paint: { kind: 'scalar' },
  };

  it('stops once an alarmed difference without a band is known to be a change', () => {
    const analysis = analyzeBenchmark(
      alarmedRender,
      benchmarkOf({ current: clearlySlower, baseline: noisy }),
    );
    expect(differencesResolved(analysis)).toBe(true);
  });

  it('keeps sampling while an alarmed difference without a band could still be none', () => {
    const analysis = analyzeBenchmark(
      alarmedRender,
      benchmarkOf({ current: sameish, baseline: noisy }),
    );
    expect(differencesResolved(analysis)).toBe(false);
  });

  it('ignores metrics that do not alarm when some do', () => {
    const analysis = analyzeBenchmark(
      { render: { kind: 'scalar', alarm: {} }, paint: { kind: 'scalar' } },
      benchmarkOf(
        { current: clearlySlower, baseline: noisy },
        { current: sameish, baseline: noisy },
      ),
    );
    expect(differencesResolved(analysis)).toBe(true);
  });

  it('stops at once when nothing can alarm', () => {
    const analysis = analyzeBenchmark(
      { render: { kind: 'scalar' }, paint: { kind: 'scalar' } },
      benchmarkOf({ current: sameish, baseline: noisy }),
    );
    expect(differencesResolved(analysis)).toBe(true);
  });

  it('stops at once for a compare(), whose differences never alarm', () => {
    const analysis = analyzeBenchmark(alarmedRender, {
      ...benchmarkOf({ current: sameish, baseline: noisy }),
      kind: 'compare',
    });
    expect(differencesResolved(analysis)).toBe(true);
  });

  it("settles against the alarm's error band", () => {
    const banded = (error: number) => ({ render: { kind: 'scalar' as const, alarm: { error } } });
    // About +100%: clearly within a 200% band, still straddling a 100% one.
    const slower = benchmarkOf({ current: clearlySlower, baseline: noisy });
    expect(differencesResolved(analyzeBenchmark(banded(2), slower))).toBe(true);
    expect(differencesResolved(analyzeBenchmark(banded(1), slower))).toBe(false);
  });

  it("follows the benchmark's own alarm over the metric's", () => {
    const unsure = benchmarkOf({ current: sameish, baseline: noisy });
    const withAlarms = (alarms: RunBenchmark['alarms']) =>
      differencesResolved(analyzeBenchmark(alarmedRender, { ...unsure, alarms }));
    expect(withAlarms(undefined)).toBe(false);
    expect(withAlarms({ render: { error: 0.5 } })).toBe(true);
    expect(withAlarms({ render: null })).toBe(true);
  });
});
