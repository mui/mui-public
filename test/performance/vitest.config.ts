import { defineConfig } from 'vitest/config';
import { createBenchmarkVitestConfig } from '@mui/internal-benchmark/vitest';

export default defineConfig(() => createBenchmarkVitestConfig());
