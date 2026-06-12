/**
 * @vitest-environment jsdom
 *
 * Integration test for `CoordinatedLazy`'s `awaitContent` mode: the content is
 * mounted behind the fallback and loads in the background (a `LazyContent`
 * returning `null`), then reports ready so the swap reveals it - the model the
 * code highlighter uses to lazy-load its content component.
 */
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
// eslint-disable-next-line testing-library/no-manual-cleanup -- root vitest config does not set `globals: true`, so RTL's auto `afterEach(cleanup)` is a no-op here.
import { render, screen, act, waitFor, cleanup } from '@testing-library/react';
import { CoordinatedLazy } from './CoordinatedLazy';
import { LazyContent } from './LazyContent';

afterEach(cleanup);

function FullContent() {
  return <div data-testid="content">full</div>;
}

/** A dynamic import the test resolves on demand, to observe the loading window. */
function deferredImport() {
  let resolve!: () => void;
  const promise = new Promise<{ default: React.ComponentType }>((res) => {
    resolve = () => res({ default: FullContent });
  });
  return { content: () => promise, resolve };
}

describe('CoordinatedLazy awaitContent', () => {
  it('shows the fallback while the lazy content loads in the background, then swaps', async () => {
    const { content, resolve } = deferredImport();
    render(
      <CoordinatedLazy
        awaitContent
        ready
        fallback={<div data-testid="loading">loading</div>}
        content={<LazyContent content={content} />}
      />,
    );

    // The fallback is visible; the content is mounted (loading) but renders null
    // until its chunk arrives, so it is not yet in the DOM.
    expect(screen.getByTestId('loading')).toBeTruthy();
    expect(screen.queryByTestId('content')).toBeNull();

    await act(async () => {
      resolve();
      await Promise.resolve();
    });

    // The content reported ready, so the swap reveals it and drops the fallback.
    await screen.findByTestId('content');
    await waitFor(() => expect(screen.queryByTestId('loading')).toBeNull());
  });
});
