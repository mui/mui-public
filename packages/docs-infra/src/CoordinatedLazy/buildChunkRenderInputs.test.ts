import { describe, it, expect } from 'vitest';
import { buildChunkRenderInputs } from './buildChunkRenderInputs';
import type { ChunkContentProps, CreateChunkConfig } from './types';

function Content(_props: ChunkContentProps): null {
  return null;
}

const base: CreateChunkConfig = { ChunkContent: Content };

describe('buildChunkRenderInputs', () => {
  describe('isLoaded', () => {
    it('is true when preloaded is defined (default predicate)', () => {
      expect(buildChunkRenderInputs(base, { preloaded: { v: 1 } }).isLoaded).toBe(true);
    });

    it('is false when preloaded is undefined (default predicate)', () => {
      expect(buildChunkRenderInputs(base, {}).isLoaded).toBe(false);
    });

    it('is true when controlled, even without preloaded', () => {
      expect(buildChunkRenderInputs(base, { controlled: true }).isLoaded).toBe(true);
    });

    it('defers to a custom isLoaded predicate', () => {
      const config: CreateChunkConfig = { ...base, isLoaded: (value) => value === 'ready' };
      expect(buildChunkRenderInputs(config, { preloaded: 'ready' }).isLoaded).toBe(true);
      expect(buildChunkRenderInputs(config, { preloaded: 'no' }).isLoaded).toBe(false);
    });
  });

  describe('isInitial', () => {
    it('is false without an isInitial predicate', () => {
      expect(buildChunkRenderInputs(base, {}).isInitial).toBe(false);
    });

    it('defers to a custom isInitial predicate', () => {
      const config: CreateChunkConfig = { ...base, isInitial: (value) => value === 'partial' };
      expect(buildChunkRenderInputs(config, { preloaded: 'partial' }).isInitial).toBe(true);
    });
  });

  describe('server loaders', () => {
    it('reports hasServerLoader from config.Loader', () => {
      const config: CreateChunkConfig = { ...base, Loader: async () => ({ default: Content }) };
      expect(buildChunkRenderInputs(config, {}).hasServerLoader).toBe(true);
      expect(buildChunkRenderInputs(base, {}).hasServerLoader).toBe(false);
    });

    it('reports hasServerInitial from config.InitialLoader', () => {
      const config: CreateChunkConfig = {
        ...base,
        InitialLoader: async () => ({ default: Content }),
      };
      expect(buildChunkRenderInputs(config, {}).hasServerInitial).toBe(true);
      expect(buildChunkRenderInputs(base, {}).hasServerInitial).toBe(false);
    });
  });

  describe('source loaders', () => {
    it('reports hasSourceLoader for any source mode', () => {
      const dataConfig: CreateChunkConfig = {
        ...base,
        source: { mode: 'data', load: async () => 1 },
      };
      expect(buildChunkRenderInputs(dataConfig, {}).hasSourceLoader).toBe(true);
    });

    it('reports hasSourceInitial for a data source with initial()', () => {
      const config: CreateChunkConfig = {
        ...base,
        source: { mode: 'data', load: async () => 1, initial: () => 0 },
      };
      expect(buildChunkRenderInputs(config, {}).hasSourceInitial).toBe(true);
    });

    it('reports hasSourceInitial for a urls source with initialUrls()', () => {
      const config: CreateChunkConfig = {
        ...base,
        source: {
          mode: 'urls',
          loadUrls: async () => ({ chunks: [] }),
          loadChunk: async () => 1,
          initialUrls: () => ({ chunks: [] }),
        },
      };
      expect(buildChunkRenderInputs(config, {}).hasSourceInitial).toBe(true);
    });

    it('reports no source loaders when there is no source', () => {
      expect(buildChunkRenderInputs(base, {}).hasSourceLoader).toBe(false);
      expect(buildChunkRenderInputs(base, {}).hasSourceInitial).toBe(false);
    });
  });
});
