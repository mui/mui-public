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

    it('lets a per-render props.isInitial override win over the config predicate', () => {
      const offConfig: CreateChunkConfig = { ...base, isInitial: () => false };
      expect(buildChunkRenderInputs(offConfig, { isInitial: true }).isInitial).toBe(true);
      const onConfig: CreateChunkConfig = { ...base, isInitial: () => true };
      expect(buildChunkRenderInputs(onConfig, { isInitial: false }).isInitial).toBe(false);
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

  describe('config source (a server loader)', () => {
    it('reports hasServerLoader for a data-mode source', () => {
      const dataConfig: CreateChunkConfig = {
        ...base,
        source: { mode: 'data', load: async () => 1 },
      };
      expect(buildChunkRenderInputs(dataConfig, {}).hasServerLoader).toBe(true);
    });

    it('reports hasServerInitial for a data source with initial()', () => {
      const config: CreateChunkConfig = {
        ...base,
        source: { mode: 'data', load: async () => 1, initial: () => 0 },
      };
      expect(buildChunkRenderInputs(config, {}).hasServerInitial).toBe(true);
    });

    it('reports no server loader for a urls source (no server-execution branch yet)', () => {
      const config: CreateChunkConfig = {
        ...base,
        source: {
          mode: 'urls',
          loadUrls: async () => ({ chunks: [] }),
          loadChunk: async () => 1,
          initialUrls: () => ({ chunks: [] }),
        },
      };
      expect(buildChunkRenderInputs(config, {}).hasServerLoader).toBe(false);
      expect(buildChunkRenderInputs(config, {}).hasServerInitial).toBe(false);
    });

    it('reports no server loaders when there is no source', () => {
      expect(buildChunkRenderInputs(base, {}).hasServerLoader).toBe(false);
      expect(buildChunkRenderInputs(base, {}).hasServerInitial).toBe(false);
    });
  });

  describe('forceClient', () => {
    const serverConfig: CreateChunkConfig = {
      ...base,
      Loader: async () => ({ default: Content }),
      InitialLoader: async () => ({ default: Content }),
    };

    it('zeroes the server loaders so the decision routes to the client', () => {
      const { hasServerLoader, hasServerInitial } = buildChunkRenderInputs(serverConfig, {
        forceClient: true,
      });
      expect(hasServerLoader).toBe(false);
      expect(hasServerInitial).toBe(false);
    });

    it('zeroes a config data source too, so the chunk loads via a ChunkProvider', () => {
      const config: CreateChunkConfig = {
        ...serverConfig,
        source: { mode: 'data', load: async () => 1, initial: () => 0 },
      };
      const { hasServerLoader, hasServerInitial } = buildChunkRenderInputs(config, {
        forceClient: true,
      });
      expect(hasServerLoader).toBe(false);
      expect(hasServerInitial).toBe(false);
    });

    it('does not affect isLoaded (a loaded chunk still renders content)', () => {
      const { isLoaded } = buildChunkRenderInputs(serverConfig, {
        preloaded: { v: 1 },
        forceClient: true,
      });
      expect(isLoaded).toBe(true);
    });
  });

  describe('skipInitialLoad', () => {
    it('drops the server initial loader but keeps the full server loader', () => {
      const config: CreateChunkConfig = {
        ...base,
        Loader: async () => ({ default: Content }),
        InitialLoader: async () => ({ default: Content }),
      };
      const { hasServerInitial, hasServerLoader } = buildChunkRenderInputs(config, {
        skipInitialLoad: true,
      });
      expect(hasServerInitial).toBe(false);
      expect(hasServerLoader).toBe(true);
    });

    it('drops a data source initial but keeps the source full loader', () => {
      const config: CreateChunkConfig = {
        ...base,
        source: { mode: 'data', load: async () => 1, initial: () => 0 },
      };
      const { hasServerInitial, hasServerLoader } = buildChunkRenderInputs(config, {
        skipInitialLoad: true,
      });
      expect(hasServerInitial).toBe(false);
      expect(hasServerLoader).toBe(true);
    });
  });
});
