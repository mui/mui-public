import type { Engine } from '../engine';

export const ENGINE_LOADERS: Record<string, () => Promise<Engine>> = {
  'starry-night': async () => (await import('./starryNight')).starryNight,
  'docs-infra': async () => (await import('./docsInfra')).docsInfra,
  highlights: async () => (await import('./highlights')).highlights,
  codemirror: async () => (await import('./codemirror')).codemirror,
};

/** The engine the others are compared against. */
export const BASELINE_ENGINE = 'starry-night';
