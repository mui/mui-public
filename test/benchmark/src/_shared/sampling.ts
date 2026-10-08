import type { SamplingOptions } from '@mui/internal-benchmark/page';

/**
 * Sampling for this smoke-test harness, which should stay quick: a benchmark whose alarmed
 * difference doesn't settle against its band stops after a minute instead of three.
 */
export const SMOKE_SAMPLING: SamplingOptions = { timeout: 1 };
