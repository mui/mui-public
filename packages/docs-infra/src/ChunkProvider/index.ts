export { ChunkProvider } from './ChunkProvider';
export { ChunkContext, useChunkContext } from './ChunkContext';

// Cross-instance preload dedup ships with the provider surface.
export { usePreload } from './usePreload';
export { PreloadProvider } from './PreloadProvider';
export { PreloadContext } from './PreloadContext';

export type { ChunkContextValue, ChunkProviderProps } from './types';
export type { PreloadFn } from './PreloadContext';
