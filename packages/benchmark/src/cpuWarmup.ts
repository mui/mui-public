/**
 * Whether the benchmark pages warm the CPU up before each timed part.
 *
 * Apple Silicon runs its cores about half as fast after they have idled for ~200ms, and the harness
 * waits for a quiet main thread before what it times, so a sample can start on a slow core. Short
 * work, such as a mount, suffers most, and unevenly across what is measured. Warming up spins the
 * CPU, outside the timed part, until it runs as fast as it did when warm.
 */
const ENV_VALUES: Record<string, boolean> = { true: true, '1': true, false: false, '0': false };

/**
 * The option when given, then `BENCHMARK_CPU_WARMUP`, then on for macOS on Apple Silicon only: the
 * hardware the slowdown was measured on. The architecture is the Node process's, so an x64 Node
 * running under Rosetta on Apple Silicon turns it off: set `BENCHMARK_CPU_WARMUP=1` there.
 */
export function resolveCpuWarmup(option?: boolean): boolean {
  if (option !== undefined) {
    return option;
  }
  const value = process.env.BENCHMARK_CPU_WARMUP;
  if (value === undefined || value === '') {
    return process.platform === 'darwin' && process.arch === 'arm64';
  }
  if (!Object.hasOwn(ENV_VALUES, value)) {
    throw new Error(
      `Unknown BENCHMARK_CPU_WARMUP value "${value}". Samples would warm up the CPU, or not, without ` +
        'anybody asking. Set it to one of: true, false, 1, 0.',
    );
  }
  return ENV_VALUES[value];
}

/** The vite config that tells the pages whether to warm up, through `process.env.BENCHMARK_CPU_WARMUP`. */
export function cpuWarmupConfig(warmup: boolean) {
  return { define: { 'process.env.BENCHMARK_CPU_WARMUP': JSON.stringify(String(warmup)) } };
}
