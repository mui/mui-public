import { afterEach, describe, expect, it } from 'vitest';
import { resolveCpuWarmup } from './cpuWarmup';

describe('resolveCpuWarmup', () => {
  const previous = process.env.BENCHMARK_CPU_WARMUP;
  afterEach(() => {
    if (previous === undefined) {
      delete process.env.BENCHMARK_CPU_WARMUP;
    } else {
      process.env.BENCHMARK_CPU_WARMUP = previous;
    }
  });

  it('reads BENCHMARK_CPU_WARMUP', () => {
    process.env.BENCHMARK_CPU_WARMUP = '1';
    expect(resolveCpuWarmup()).toBe(true);
    process.env.BENCHMARK_CPU_WARMUP = '0';
    expect(resolveCpuWarmup()).toBe(false);
  });

  it('prefers the option over the environment variable', () => {
    process.env.BENCHMARK_CPU_WARMUP = 'false';
    expect(resolveCpuWarmup(true)).toBe(true);
  });
});
