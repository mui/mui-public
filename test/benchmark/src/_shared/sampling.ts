import type { SamplingOptions } from '@mui/internal-benchmark/page';

/**
 * Sampling for this smoke-test harness, which should stay quick. Its baseline comparisons run
 * identical code on both sides, so they never resolve against the default `0%` horizon and would
 * sample until the timeout; a close `compare()` can take as long. A `10%` horizon settles as soon as
 * a difference is known to be larger or smaller than that.
 */
export const SMOKE_SAMPLING: SamplingOptions = { timeout: 1, autoSampleConditions: ['10%'] };
