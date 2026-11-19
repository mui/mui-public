/**
 * @vitest-environment jsdom
 *
 * Contract for the first-render speculative grammar preload: a block that will
 * highlight client-side loads the highlighter for the grammar scopes its variants
 * need, in a mount effect, before `useCode` parses. A block that won't
 * highlight client-side (disabled — e.g. fully precomputed) loads nothing.
 */
import * as React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useSpeculativeGrammarPreload } from './useSpeculativeGrammarPreload';
import { areGrammarsRegistered } from '../pipeline/parseSource/grammarCache';
import { resetHighlighter } from '../pipeline/parseSource/parseSource';

beforeEach(() => {
  resetHighlighter();
});

function setup(props: { scopes: string[]; enabled: boolean }) {
  function Speculative() {
    useSpeculativeGrammarPreload(props);
    return null;
  }
  render(<Speculative />);
}

describe('useSpeculativeGrammarPreload', () => {
  it('preloads the requested scopes when enabled', async () => {
    setup({ scopes: ['source.tsx', 'source.css'], enabled: true });

    await waitFor(() => expect(areGrammarsRegistered(['source.tsx', 'source.css'])).toBe(true));
  });

  it('preloads nothing when disabled', async () => {
    setup({ scopes: ['source.tsx'], enabled: false });

    await Promise.resolve();
    expect(areGrammarsRegistered(['source.tsx'])).toBe(false);
  });

  it('does nothing for an empty scope list', () => {
    expect(() => setup({ scopes: [], enabled: true })).not.toThrow();
  });
});
