import type { SamplingOptions } from '@mui/internal-benchmark/page';

/**
 * Sampling for this smoke-test harness. Both sides of its baseline comparisons run identical code, so
 * no difference ever resolves against the default `0%` horizon and every case would sample until
 * its timeout. A `10%` horizon settles as soon as a difference is known to be smaller than that.
 */
export const SMOKE_SAMPLING: SamplingOptions = { timeout: 1, autoSampleConditions: ['10%'] };
