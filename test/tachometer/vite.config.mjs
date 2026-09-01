import { defineConfig } from 'vite';
import { tachometer } from '@mui/internal-code-infra/tachometerPlugin';

// The plugin contributes everything derived from the benchmark cases: the `src/` root, the
// multi-page app type, the build's entry points, and the dev-server case index.
export default defineConfig({ plugins: [tachometer()] });
