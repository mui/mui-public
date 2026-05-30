import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { createCoordinatedLazy } from './createCoordinatedLazy';
import { ChunkServerLoader } from './ChunkServerLoader';
import { CoordinatedLazyClient } from './CoordinatedLazyClient';
import type {
  ChunkComponentProps,
  ChunkContentProps,
  ChunkLoadingProps,
  CreateChunkConfig,
} from './types';

function Content(_props: ChunkContentProps): null {
  return null;
}
function Loading(_props: ChunkLoadingProps): null {
  return null;
}

// Calling the factory's component as a plain function lets us inspect the routed
// element (which branch of resolveChunkRender it took) without rendering async
// server components, which a DOM environment cannot execute.
function routeOf<T extends {}, P, O>(
  config: CreateChunkConfig<T, P, O>,
  props: ChunkComponentProps<T, P, O> = {},
): React.ReactElement {
  const Comp = createCoordinatedLazy(config) as (
    p: ChunkComponentProps<T, P, O>,
  ) => React.ReactElement;
  return Comp(props);
}

/** Extract the (typed) child a routed Suspense element wraps. */
function suspenseChild(element: React.ReactElement): React.ReactElement<{ initial: boolean }> {
  const props = element.props as { children: React.ReactElement<{ initial: boolean }> };
  return props.children;
}

const baseConfig = { ChunkContent: Content, ChunkLoading: Loading };

describe('createCoordinatedLazy routing', () => {
  it('content mode: renders ChunkContent directly (server HTML, no swap) when preloaded', () => {
    const element = routeOf(baseConfig, { preloaded: { v: 1 } });
    expect(element.type).toBe(Content);
    expect(element.props).toMatchObject({ data: { v: 1 }, loading: false });
  });

  it('content mode: renders ChunkContent directly when controlled', () => {
    const element = routeOf(baseConfig, { controlled: true });
    expect(element.type).toBe(Content);
  });

  it('server-loader mode: ChunkServerLoader under Suspense when a server Loader is configured', () => {
    const element = routeOf({ ...baseConfig, Loader: async () => ({ default: Content }) });
    expect(element.type).toBe(React.Suspense);
    expect(suspenseChild(element).type).toBe(ChunkServerLoader);
    expect(suspenseChild(element).props.initial).toBe(false);
  });

  it('server-initial mode: ChunkServerLoader (initial) when isInitial + InitialLoader', () => {
    const element = routeOf(
      {
        ...baseConfig,
        isLoaded: () => false,
        isInitial: () => true,
        InitialLoader: async () => ({ default: Loading }),
      },
      { preloaded: 'partial' },
    );
    expect(element.type).toBe(React.Suspense);
    expect(suspenseChild(element).type).toBe(ChunkServerLoader);
    expect(suspenseChild(element).props.initial).toBe(true);
  });

  it('client mode: delegates to CoordinatedLazyClient for a client data source', () => {
    const element = routeOf({ ...baseConfig, source: { mode: 'data', load: async () => 1 } });
    expect(element.type).toBe(CoordinatedLazyClient);
  });

  it('client mode: delegates to CoordinatedLazyClient when there is no loader at all', () => {
    const element = routeOf(baseConfig);
    expect(element.type).toBe(CoordinatedLazyClient);
  });

  it('server wins over client: a server Loader is chosen over a client source', () => {
    const element = routeOf({
      ...baseConfig,
      Loader: async () => ({ default: Content }),
      source: { mode: 'data', load: async () => 1 },
    });
    expect(element.type).toBe(React.Suspense);
    expect(suspenseChild(element).type).toBe(ChunkServerLoader);
  });
});
