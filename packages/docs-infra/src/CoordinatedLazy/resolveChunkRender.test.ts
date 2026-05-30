import { describe, it, expect } from 'vitest';
import { resolveChunkRender } from './resolveChunkRender';
import type { ChunkRenderInputs } from './types';

/** Base inputs: nothing loaded/initial, no providers. */
const base: ChunkRenderInputs = {
  isLoaded: false,
  isInitial: false,
  hasServerInitial: false,
  hasSourceInitial: false,
  hasServerLoader: false,
  hasSourceLoader: false,
};

describe('resolveChunkRender', () => {
  it('renders content when loaded (and reports not loading)', () => {
    expect(resolveChunkRender({ ...base, isLoaded: true })).toEqual({
      mode: 'content',
      loading: false,
    });
  });

  it('prefers content over every other branch when loaded', () => {
    expect(
      resolveChunkRender({
        ...base,
        isLoaded: true,
        isInitial: true,
        hasServerInitial: true,
        hasServerLoader: true,
      }),
    ).toEqual({ mode: 'content', loading: false });
  });

  // `isInitial` means the initial paint is ALREADY available (no need to fetch
  // it). So it never routes to an initial *loader*; it renders the content
  // (still loading) and, if a full loader exists, loads the full in the
  // background behind that initial.
  describe('have-initial branch (isInitial: the initial paint is already in hand)', () => {
    it('loads the full content on the server, showing the initial as the fallback', () => {
      expect(resolveChunkRender({ ...base, isInitial: true, hasServerLoader: true })).toEqual({
        mode: 'server-loader',
        loading: true,
      });
    });

    it('loads the full content on the client when only a source loader exists', () => {
      expect(resolveChunkRender({ ...base, isInitial: true, hasSourceLoader: true })).toEqual({
        mode: 'async-loader',
        loading: true,
      });
    });

    it('renders the content directly (loading) when there is no full loader', () => {
      expect(resolveChunkRender({ ...base, isInitial: true })).toEqual({
        mode: 'content-initial',
        loading: true,
      });
    });

    it('ignores the initial loaders when the initial is already in hand', () => {
      // We already have the initial paint, so an InitialLoader/source-initial is
      // irrelevant - with no full loader we just render the content (loading).
      expect(
        resolveChunkRender({
          ...base,
          isInitial: true,
          hasServerInitial: true,
          hasSourceInitial: true,
        }),
      ).toEqual({ mode: 'content-initial', loading: true });
    });
  });

  // No full content AND no initial paint in hand: fetch a quick initial first
  // (server, then source), else go straight to loading the full, else let the
  // client attempt it.
  describe('load-initial branch (no initial paint in hand)', () => {
    it('prefers the server initial loader', () => {
      expect(
        resolveChunkRender({ ...base, hasServerInitial: true, hasSourceInitial: true }),
      ).toEqual({ mode: 'server-initial', loading: true });
    });

    it('falls back to the source initial loader', () => {
      expect(resolveChunkRender({ ...base, hasSourceInitial: true })).toEqual({
        mode: 'async-initial',
        loading: true,
      });
    });

    it('skips straight to the server full loader when no initial loader exists', () => {
      expect(resolveChunkRender({ ...base, hasServerLoader: true })).toEqual({
        mode: 'server-loader',
        loading: true,
      });
    });

    it('falls back to the source full loader', () => {
      expect(resolveChunkRender({ ...base, hasSourceLoader: true })).toEqual({
        mode: 'async-loader',
        loading: true,
      });
    });

    it('attempts the initial data on the client when no provider exists at all', () => {
      expect(resolveChunkRender(base)).toEqual({
        mode: 'attempt-initial-client',
        loading: true,
      });
    });
  });

  it('prefers fetching an initial over loading the full when neither is in hand', () => {
    // With no initial paint yet, a quick server initial wins over the full
    // server loader, so the user sees something fast.
    expect(resolveChunkRender({ ...base, hasServerInitial: true, hasServerLoader: true })).toEqual({
      mode: 'server-initial',
      loading: true,
    });
  });
});
