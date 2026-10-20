import type { SamplingOptions } from '@mui/internal-benchmark/page';

/**
 * Sampling for this harness, which checks that the CLI works end to end rather than guarding a
 * library: a few rounds, never more, so the CI job stays as quick as the others.
 */
export const SMOKE_SAMPLING: SamplingOptions = { sampleSize: 10, timeout: 0 };
