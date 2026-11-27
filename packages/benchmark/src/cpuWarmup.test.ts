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

  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('reads BENCHMARK_CPU_WARMUP=%s', (value, expected) => {
    process.env.BENCHMARK_CPU_WARMUP = value;
    expect(resolveCpuWarmup()).toBe(expected);
  });

  it('prefers the option over the environment variable', () => {
    process.env.BENCHMARK_CPU_WARMUP = 'false';
    expect(resolveCpuWarmup(true)).toBe(true);
  });

  it.each(['yes', 'constructor', 'toString'])('rejects the value "%s"', (value) => {
    process.env.BENCHMARK_CPU_WARMUP = value;
    expect(() => resolveCpuWarmup()).toThrow(`Unknown BENCHMARK_CPU_WARMUP value "${value}"`);
  });
});
