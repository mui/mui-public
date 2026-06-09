// The coordinated fallback<->content swap, plus the self-loading factory built
// on it: `createCoordinatedLazy` produces one deferred piece (a demo, a chart, a
// code frame). To stream a _list_ of pieces in on the client, use the separate
// `@mui/internal-docs-infra/useStream` export. The server render functions
// (`ChunkServerLoader`, `LazyContentServer`) are plain async components with no
// Node-only imports, so they ship from this same entry - inert on the client.
export { CoordinatedLazy } from './CoordinatedLazy';
export { createCoordinatedLazy } from './createCoordinatedLazy';
export { useChunk } from './useChunk';
export { useCoordinatedSwap } from './useCoordinatedSwap';
export { useCoordinatedFallback } from './useCoordinatedFallback';
export { LazyContent } from './LazyContent';
export { LazyContentServer } from './LazyContentServer';
export { ChunkServerLoader } from './ChunkServerLoader';
export { resolveChunkRender } from './resolveChunkRender';
export { CoordinatedFallbackContext } from './CoordinatedFallbackContext';
export { CoordinatedContentContext, useCoordinatedContent } from './CoordinatedContentContext';
export { CoordinatedGateContext, useCoordinatedGate } from './CoordinatedGateContext';

export type { UseChunkResult } from './useChunk';
export type {
  CoordinatedLazyProps,
  CoordinatedFallbackContextValue,
  CoordinatedContentContextValue,
  UseCoordinatedFallbackResult,
  UseCoordinatedSwapOptions,
  UseCoordinatedSwapResult,
  ChunkContentProps,
  ChunkLoadingProps,
  ChunkComponentProps,
  StreamSource,
  StreamUrlsResult,
  ChunkSwapConfig,
  CreateChunkConfig,
  IsLoaded,
  IsInitial,
  ChunkRenderMode,
  ChunkRenderInputs,
  ChunkRenderDecision,
  LazyContentProps,
  LazyComponentImport,
} from './types';
