import { afterEach, describe, expect, it } from 'vitest';
import { reactBuildConfig, resolveReactBuild } from './reactBuild';

describe('resolveReactBuild', () => {
  const previous = process.env.BENCHMARK_REACT_BUILD;
  afterEach(() => {
    if (previous === undefined) {
      delete process.env.BENCHMARK_REACT_BUILD;
    } else {
      process.env.BENCHMARK_REACT_BUILD = previous;
    }
  });

  it('defaults to the profiling build', () => {
    delete process.env.BENCHMARK_REACT_BUILD;
    expect(resolveReactBuild()).toBe('profiling');
  });

  it('reads BENCHMARK_REACT_BUILD', () => {
    process.env.BENCHMARK_REACT_BUILD = 'production';
    expect(resolveReactBuild()).toBe('production');
  });

  it('prefers the option over the environment variable', () => {
    process.env.BENCHMARK_REACT_BUILD = 'production';
    expect(resolveReactBuild('profiling')).toBe('profiling');
  });

  it('rejects an unknown build', () => {
    process.env.BENCHMARK_REACT_BUILD = 'development';
    expect(() => resolveReactBuild()).toThrow('Unknown React build "development"');
  });
});

describe('reactBuildConfig', () => {
  it('aliases react-dom/client to the profiling build when profiling', () => {
    expect(reactBuildConfig('profiling')).toEqual({
      alias: [{ find: 'react-dom/client', replacement: 'react-dom/profiling' }],
      define: { 'process.env.BENCHMARK_REACT_BUILD': '"profiling"' },
    });
  });

  it('leaves react-dom/client alone for the production build', () => {
    expect(reactBuildConfig('production')).toEqual({
      alias: [],
      define: { 'process.env.BENCHMARK_REACT_BUILD': '"production"' },
    });
  });
});
