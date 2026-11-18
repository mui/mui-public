import { afterEach, describe, expect, it } from 'vitest';
import { reactProfilingConfig, resolveReactProfiling } from './reactProfiling';

describe('resolveReactProfiling', () => {
  const previous = process.env.BENCHMARK_REACT_PROFILING;
  afterEach(() => {
    if (previous === undefined) {
      delete process.env.BENCHMARK_REACT_PROFILING;
    } else {
      process.env.BENCHMARK_REACT_PROFILING = previous;
    }
  });

  it('defaults to the profiling build', () => {
    delete process.env.BENCHMARK_REACT_PROFILING;
    expect(resolveReactProfiling()).toBe(true);
  });

  it.each([
    ['false', false],
    ['0', false],
    ['true', true],
    ['1', true],
  ])('reads BENCHMARK_REACT_PROFILING=%s', (value, expected) => {
    process.env.BENCHMARK_REACT_PROFILING = value;
    expect(resolveReactProfiling()).toBe(expected);
  });

  it('prefers the option over the environment variable', () => {
    process.env.BENCHMARK_REACT_PROFILING = 'false';
    expect(resolveReactProfiling(true)).toBe(true);
  });

  it('rejects an unknown value', () => {
    process.env.BENCHMARK_REACT_PROFILING = 'production';
    expect(() => resolveReactProfiling()).toThrow(
      'Unknown BENCHMARK_REACT_PROFILING value "production"',
    );
  });
});

describe('reactProfilingConfig', () => {
  it('aliases react-dom/client to the profiling build when profiling', () => {
    expect(reactProfilingConfig(true)).toEqual({
      alias: [{ find: 'react-dom/client', replacement: 'react-dom/profiling' }],
      define: { 'process.env.BENCHMARK_REACT_PROFILING': '"true"' },
    });
  });

  it('leaves react-dom/client alone for the production build', () => {
    expect(reactProfilingConfig(false)).toEqual({
      alias: [],
      define: { 'process.env.BENCHMARK_REACT_PROFILING': '"false"' },
    });
  });
});
