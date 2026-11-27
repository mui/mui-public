// Whether the benchmark pages warm the CPU up right before what they time. See "Warming the CPU up"
// in the README for why; `page/warmUpCpu.ts` is the warm-up itself.
import { resolveBooleanSetting } from './booleanSetting';

/**
 * The option when given, then `BENCHMARK_CPU_WARMUP`, then on for macOS on Apple Silicon only: the
 * hardware the slowdown was measured on. The architecture is the Node process's, so an x64 Node
 * running under Rosetta on Apple Silicon turns it off: set `BENCHMARK_CPU_WARMUP=1` there.
 */
export function resolveCpuWarmup(option?: boolean): boolean {
  return resolveBooleanSetting(
    'BENCHMARK_CPU_WARMUP',
    option,
    process.platform === 'darwin' && process.arch === 'arm64',
    'Samples would warm up the CPU, or not, without anybody asking.',
  );
}

/** The vite `define` that tells the pages whether to warm up. */
export function cpuWarmupDefine(warmup: boolean) {
  return { 'process.env.BENCHMARK_CPU_WARMUP': JSON.stringify(String(warmup)) };
}
