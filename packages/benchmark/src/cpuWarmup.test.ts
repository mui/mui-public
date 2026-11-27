import { afterEach, describe, expect, it } from 'vitest';
import { resolveCpuWarmup } from './cpuWarmup';

const APPLE_SILICON = { platform: 'darwin', arch: 'arm64' };
const LINUX = { platform: 'linux', arch: 'x64' };

describe('resolveCpuWarmup', () => {
  const previous = process.env.BENCHMARK_CPU_WARMUP;
  afterEach(() => {
    if (previous === undefined) {
      delete process.env.BENCHMARK_CPU_WARMUP;
    } else {
      process.env.BENCHMARK_CPU_WARMUP = previous;
    }
  });

  it('warms up on macOS on Apple Silicon only, by default', () => {
    delete process.env.BENCHMARK_CPU_WARMUP;
    expect(resolveCpuWarmup(undefined, APPLE_SILICON)).toBe(true);
    expect(resolveCpuWarmup(undefined, { platform: 'darwin', arch: 'x64' })).toBe(false);
    expect(resolveCpuWarmup(undefined, LINUX)).toBe(false);
  });

  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('reads BENCHMARK_CPU_WARMUP=%s on any platform', (value, expected) => {
    process.env.BENCHMARK_CPU_WARMUP = value;
    expect(resolveCpuWarmup(undefined, APPLE_SILICON)).toBe(expected);
    expect(resolveCpuWarmup(undefined, LINUX)).toBe(expected);
  });

  it('prefers the option over the environment variable', () => {
    process.env.BENCHMARK_CPU_WARMUP = 'false';
    expect(resolveCpuWarmup(true, LINUX)).toBe(true);
  });

  it('rejects an unknown value', () => {
    process.env.BENCHMARK_CPU_WARMUP = 'yes';
    expect(() => resolveCpuWarmup(undefined, LINUX)).toThrow(
      'Unknown BENCHMARK_CPU_WARMUP value "yes"',
    );
  });
});
