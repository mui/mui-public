/**
 * @vitest-environment jsdom
 *
 * Contract for the first-render speculative engine preload: a block that will
 * highlight client-side loads the highlighting engine in a mount effect, before
 * `useCode` parses. A block that won't highlight client-side (disabled — e.g.
 * fully precomputed) loads nothing.
 */
import * as React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useSpeculativeHighlighterPreload } from './useSpeculativeHighlighterPreload';
import { isHighlighterLoaded } from '../pipeline/parseSource/highlighterCache';
import { resetHighlighter } from '../pipeline/parseSource/parseSource';

beforeEach(() => {
  resetHighlighter();
});

function setup(enabled: boolean) {
  function Speculative() {
    useSpeculativeHighlighterPreload(enabled);
    return null;
  }
  render(<Speculative />);
}

describe('useSpeculativeHighlighterPreload', () => {
  it('loads the engine when enabled', async () => {
    setup(true);

    await waitFor(() => expect(isHighlighterLoaded()).toBe(true));
  });

  it('loads nothing when disabled', async () => {
    setup(false);

    await Promise.resolve();
    expect(isHighlighterLoaded()).toBe(false);
  });
});
