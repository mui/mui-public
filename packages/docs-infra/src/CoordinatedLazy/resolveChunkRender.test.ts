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

  it('prefers content over the initial branch when both apply', () => {
    expect(
      resolveChunkRender({ ...base, isLoaded: true, isInitial: true, hasServerInitial: true }),
    ).toEqual({ mode: 'content', loading: false });
  });

  describe('initial branch', () => {
    it('prefers the server initial loader', () => {
      expect(
        resolveChunkRender({
          ...base,
          isInitial: true,
          hasServerInitial: true,
          hasSourceInitial: true,
        }),
      ).toEqual({ mode: 'server-initial', loading: true });
    });

    it('falls back to the source initial loader', () => {
      expect(resolveChunkRender({ ...base, isInitial: true, hasSourceInitial: true })).toEqual({
        mode: 'async-initial',
        loading: true,
      });
    });

    it('renders null for the client when no initial provider exists', () => {
      expect(resolveChunkRender({ ...base, isInitial: true })).toEqual({
        mode: 'null-client',
        loading: true,
      });
    });
  });

  describe('loader branch', () => {
    it('prefers the server loader', () => {
      expect(resolveChunkRender({ ...base, hasServerLoader: true, hasSourceLoader: true })).toEqual(
        { mode: 'server-loader', loading: true },
      );
    });

    it('falls back to the source loader', () => {
      expect(resolveChunkRender({ ...base, hasSourceLoader: true })).toEqual({
        mode: 'async-loader',
        loading: true,
      });
    });

    it('attempts the initial data on the client when no loader provider exists', () => {
      expect(resolveChunkRender(base)).toEqual({
        mode: 'attempt-initial-client',
        loading: true,
      });
    });
  });

  it('takes the loader branch (not initial) when isInitial is false', () => {
    // Even with an initial provider present, a false `isInitial` skips it.
    expect(resolveChunkRender({ ...base, hasSourceInitial: true, hasSourceLoader: true })).toEqual({
      mode: 'async-loader',
      loading: true,
    });
  });
});
