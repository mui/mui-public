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

  it('server-initial mode: ChunkServerLoader (initial) when an InitialLoader exists and no initial is in hand', () => {
    // No initial paint in hand (isInitial false) but an InitialLoader is
    // configured -> fetch a quick initial on the server.
    const element = routeOf({
      ...baseConfig,
      isLoaded: () => false,
      isInitial: () => false,
      InitialLoader: async () => ({ default: Content }),
    });
    expect(element.type).toBe(React.Suspense);
    expect(suspenseChild(element).type).toBe(ChunkServerLoader);
    expect(suspenseChild(element).props.initial).toBe(true);
  });

  it('content-initial mode: renders ChunkContent (loading) when the initial is in hand and there is no full loader', () => {
    // The initial paint is already in hand, so we do not fetch another one via
    // the InitialLoader; with no full loader we render the content from the
    // initial and let it own any further client load/swap.
    const element = routeOf(
      {
        ...baseConfig,
        isLoaded: () => false,
        isInitial: () => true,
        InitialLoader: async () => ({ default: Content }),
      },
      { preloaded: 'partial' },
    );
    expect(element.type).toBe(Content);
    expect(element.props).toMatchObject({ data: 'partial', loading: true });
  });

  it('have-initial + server Loader: loads the full content on the server behind the initial', () => {
    // The initial is in hand AND a full server Loader exists -> load the full on
    // the server (the initial is the Suspense fallback), not the InitialLoader.
    const element = routeOf(
      {
        ...baseConfig,
        isLoaded: () => false,
        isInitial: () => true,
        InitialLoader: async () => ({ default: Content }),
        Loader: async () => ({ default: Content }),
      },
      { preloaded: 'partial' },
    );
    expect(element.type).toBe(React.Suspense);
    expect(suspenseChild(element).type).toBe(ChunkServerLoader);
    expect(suspenseChild(element).props.initial).toBe(false);
  });

  it('server mode: routes a config data source to ChunkServerLoader under Suspense', () => {
    // A config `source` is a SERVER loader now, not a client one - it renders via
    // ChunkServerLoader, never CoordinatedLazyClient.
    const element = routeOf({ ...baseConfig, source: { mode: 'data', load: async () => 1 } });
    expect(element.type).toBe(React.Suspense);
    expect(suspenseChild(element).type).toBe(ChunkServerLoader);
    expect(suspenseChild(element).props.initial).toBe(false);
  });

  it('server-initial mode: routes a data source with initial() to ChunkServerLoader (initial=true)', () => {
    const element = routeOf({
      ...baseConfig,
      source: { mode: 'data', load: async () => 1, initial: () => 0 },
    });
    expect(element.type).toBe(React.Suspense);
    expect(suspenseChild(element).type).toBe(ChunkServerLoader);
    expect(suspenseChild(element).props.initial).toBe(true);
  });

  it('client mode: delegates to CoordinatedLazyClient when there is no loader at all', () => {
    const element = routeOf(baseConfig);
    expect(element.type).toBe(CoordinatedLazyClient);
  });

  it('contentManagesSwap: renders ChunkContent directly (loading) for client modes instead of CoordinatedLazyClient', () => {
    // attempt-initial-client with self-managing content -> render ChunkContent
    // directly (it owns its own client load + swap), not the framework wrapper.
    const element = routeOf({ ...baseConfig, contentManagesSwap: true });
    expect(element.type).toBe(Content);
    expect(element.props).toMatchObject({ loading: true });
  });

  it('forceClient: routes around a configured server Loader to the client', () => {
    const element = routeOf(
      { ...baseConfig, Loader: async () => ({ default: Content }) },
      { forceClient: true },
    );
    expect(element.type).toBe(CoordinatedLazyClient);
  });

  it('forceClient: routes a source-only config to the client (attempt-initial-client)', () => {
    const element = routeOf(
      { ...baseConfig, source: { mode: 'data', load: async () => 1 } },
      { forceClient: true },
    );
    expect(element.type).toBe(CoordinatedLazyClient);
  });

  it('client config carries no source/Loader/InitialLoader function fields (RSC-boundary guard)', () => {
    const element = routeOf(
      {
        ...baseConfig,
        source: { mode: 'data', load: async () => 1, initial: () => 0 },
        Loader: async () => ({ default: Content }),
        InitialLoader: async () => ({ default: Content }),
      },
      { forceClient: true },
    );
    expect(element.type).toBe(CoordinatedLazyClient);
    const clientConfig = (element.props as { config: Record<string, unknown> }).config;
    expect(clientConfig.source).toBeUndefined();
    expect(clientConfig.Loader).toBeUndefined();
    expect(clientConfig.InitialLoader).toBeUndefined();
  });

  it('props.isInitial override drives the have-initial branch', () => {
    // No config predicate; the consumer declares the initial is in hand. With a
    // server Loader, that loads the full on the server behind the initial.
    const element = routeOf(
      { ...baseConfig, Loader: async () => ({ default: Content }) },
      { isInitial: true },
    );
    expect(element.type).toBe(React.Suspense);
    expect(suspenseChild(element).props.initial).toBe(false);
  });

  it('awaitServerLoad: renders the server loader directly (no Suspense) so content lands in the initial HTML', () => {
    const element = routeOf(
      { ...baseConfig, Loader: async () => ({ default: Content }) },
      { awaitServerLoad: true },
    );
    expect(element.type).toBe(ChunkServerLoader);
    expect((element.props as { initial: boolean }).initial).toBe(false);
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
