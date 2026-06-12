import * as React from 'react';
import type { Code as CodeType } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { Code } from '../Code';

const source = `import { defineConfig } from 'some-bundler';

// A long config most readers will scroll past — collapse it to nothing by
// default and let them expand it on demand.
export default defineConfig({
  entry: './src/index.ts',
  format: ['esm', 'cjs'],
  target: 'es2022',
  sourcemap: true,
  dts: true,
  clean: true,
  external: ['react', 'react-dom'],
  esbuildOptions(options) {
    options.banner = {
      js: '"use client";',
    };
  },
});`;

export function CollapseToEmptyCode() {
  // @focus-start @padding 1
  const code: CodeType = {
    Default: {
      fileName: 'bundler.config.ts',
      language: 'ts',
      source,
    },
  };

  // `collapseToEmpty` collapses the whole block to an empty window: nothing is
  // shown until the reader clicks Expand. It is a render-time flag — the
  // precomputed source is unchanged.
  return <Code code={code} collapseToEmpty />;
  // @focus-end
}
