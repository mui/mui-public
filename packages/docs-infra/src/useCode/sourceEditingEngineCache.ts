import type * as SourceEditingEngine from './SourceEditingEngine';

export type SourceEditingEngineModule = typeof SourceEditingEngine;

let cached: SourceEditingEngineModule | undefined;
let pending: Promise<SourceEditingEngineModule> | undefined;

export function peekSourceEditingEngine(): SourceEditingEngineModule | undefined {
  return cached;
}

export function loadSourceEditingEngine():
  SourceEditingEngineModule | Promise<SourceEditingEngineModule> {
  if (cached) {
    return cached;
  }
  pending ??= import('./SourceEditingEngine').then(
    (module) => {
      cached = module;
      return module;
    },
    (error: unknown) => {
      pending = undefined;
      throw error;
    },
  );
  return pending;
}

export async function preloadSourceEditingEngine(): Promise<void> {
  await loadSourceEditingEngine();
}

export function resetSourceEditingEngineCache(): void {
  cached = undefined;
  pending = undefined;
}
