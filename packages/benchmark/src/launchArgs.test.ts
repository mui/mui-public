import { describe, expect, it } from 'vitest';
import { BENCHMARK_LAUNCH_ARGS, withLaunchArgs } from './launchArgs';

describe('withLaunchArgs', () => {
  it('appends flags after the fixed ones', () => {
    expect(withLaunchArgs(['--use-angle=metal'])).toEqual([
      ...BENCHMARK_LAUNCH_ARGS,
      '--use-angle=metal',
    ]);
  });

  it('keeps --expose-gc when a caller passes its own V8 flags', () => {
    // Chromium keeps only the last `--js-flags`, which would drop `--expose-gc`.
    const args = withLaunchArgs(['--js-flags=--max-lazy']);

    expect(args.filter((arg) => arg.startsWith('--js-flags='))).toEqual([
      '--js-flags=--expose-gc --max-lazy',
    ]);
    expect(args).toContain('--disable-renderer-backgrounding');
  });

  it('joins every caller --js-flags into the one flag', () => {
    expect(
      withLaunchArgs(['--js-flags=--a', '--js-flags=--b'], ['--js-flags=--expose-gc']),
    ).toEqual(['--js-flags=--expose-gc --a --b']);
  });
});
