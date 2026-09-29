import { describe, expect, it } from 'vitest';
import { analyzeBenchmark } from './runReport/analyzeRun';
import type { RunBenchmark, RunMetricDefinition } from './runReport';
import {
  DEFAULT_SAMPLING,
  differencesResolved,
  isResolved,
  parseHorizons,
  resolveSampling,
  validateSampling,
} from './sampling';

describe('resolveSampling', () => {
  it('defaults an option left undefined, not only one left out', () => {
    expect(
      resolveSampling({ sampleSize: undefined, timeout: 1, autoSampleConditions: undefined }),
    ).toEqual({ ...DEFAULT_SAMPLING, timeout: 1 });
  });
});

describe('parseHorizons', () => {
  it('expands an unsigned percentage to both signs', () => {
    expect(parseHorizons(['10%'])).toEqual([-10, 10]);
  });

  it('keeps a signed percentage to its own side', () => {
    expect(parseHorizons(['+5%', '-2.5%'])).toEqual([5, -2.5]);
  });

  it('reads zero as a single horizon', () => {
    expect(parseHorizons(['0%'])).toEqual([0]);
  });

  it('rejects anything but a percentage', () => {
    expect(() => parseHorizons(['5ms'])).toThrow(/Invalid auto-sample condition "5ms"/);
    expect(() => parseHorizons(['%'])).toThrow(/Invalid auto-sample condition "%"/);
    expect(() => parseHorizons(['ten%'])).toThrow(/Invalid auto-sample condition "ten%"/);
  });
});

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

describe('validateSampling', () => {
  it('accepts the documented ranges', () => {
    expect(() =>
      validateSampling({ sampleSize: 2, timeout: 0, autoSampleConditions: ['1%'] }),
    ).not.toThrow();
  });

  it('rejects a sample size that cannot form an interval', () => {
    expect(() => validateSampling({ sampleSize: 1 })).toThrow(/Invalid sampleSize 1/);
    expect(() => validateSampling({ sampleSize: 2.5 })).toThrow(/Invalid sampleSize 2.5/);
  });

  it('rejects a negative timeout', () => {
    expect(() => validateSampling({ timeout: -1 })).toThrow(/Invalid timeout -1/);
  });
});

describe('differencesResolved', () => {
  const noisy = [10, 12, 9, 11, 10, 13, 8, 11];
  const clearlySlower = noisy.map((value) => value * 2);
  const sameish = [11, 9, 10, 12, 11, 10, 9, 12];

  function benchmarkOf(samples: Record<string, number[]>): RunBenchmark {
    return {
      name: 'mount',
      file: 'button.bench.tsx',
      kind: 'baseline',
      variants: ['current', 'baseline'],
      samples: {
        current: { render: samples.current, paint: samples.current },
        baseline: { render: samples.baseline, paint: samples.baseline },
      },
    };
  }

  const alarmedRender: Record<string, RunMetricDefinition> = {
    render: { kind: 'scalar', alarm: {} },
    paint: { kind: 'scalar' },
  };

  it('stops once every alarmed difference is clear of the horizon', () => {
    const analysis = analyzeBenchmark(
      alarmedRender,
      benchmarkOf({ current: clearlySlower, baseline: noisy }),
    );
    expect(differencesResolved(analysis, [0])).toBe(true);
  });

  it('keeps sampling while an alarmed difference straddles the horizon', () => {
    const analysis = analyzeBenchmark(
      alarmedRender,
      benchmarkOf({ current: sameish, baseline: noisy }),
    );
    expect(differencesResolved(analysis, [0])).toBe(false);
  });

  it('ignores metrics that do not alarm when some do', () => {
    const analysis = analyzeBenchmark(
      { render: { kind: 'scalar', alarm: {} }, paint: { kind: 'scalar' } },
      {
        ...benchmarkOf({ current: clearlySlower, baseline: noisy }),
        samples: {
          current: { render: clearlySlower, paint: sameish },
          baseline: { render: noisy, paint: noisy },
        },
      },
    );
    expect(differencesResolved(analysis, [0])).toBe(true);
  });

  it('judges every metric when none alarms', () => {
    const analysis = analyzeBenchmark(
      { render: { kind: 'scalar' }, paint: { kind: 'scalar' } },
      {
        ...benchmarkOf({ current: clearlySlower, baseline: noisy }),
        samples: {
          current: { render: clearlySlower, paint: sameish },
          baseline: { render: noisy, paint: noisy },
        },
      },
    );
    expect(differencesResolved(analysis, [0])).toBe(false);
  });

  it('resolves a small difference against a wider horizon', () => {
    const analysis = analyzeBenchmark(
      alarmedRender,
      benchmarkOf({ current: sameish, baseline: noisy }),
    );
    expect(differencesResolved(analysis, [-50, 50])).toBe(true);
  });
});
