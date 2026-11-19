/**
 * @vitest-environment jsdom
 *
 * The `preloadGrammars` provider opt-in: omitted leaves grammars fully lazy;
 * a language/scope list or `'all'` loads the highlighter on mount.
 */
import * as React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { CodeProviderLazy } from './CodeProviderLazy';
import { areGrammarsRegistered } from '../pipeline/parseSource/grammarCache';
import { resetHighlighter } from '../pipeline/parseSource/parseSource';

beforeEach(() => {
  resetHighlighter();
});

describe('CodeProviderLazy preloadGrammars', () => {
  it('registers no grammars by default (fully lazy)', async () => {
    render(
      <CodeProviderLazy>
        <div />
      </CodeProviderLazy>,
    );

    await Promise.resolve();
    expect(areGrammarsRegistered(['source.tsx'])).toBe(false);
  });

  it('preloads the listed languages on mount', async () => {
    render(
      <CodeProviderLazy preloadGrammars={['tsx', 'css']}>
        <div />
      </CodeProviderLazy>,
    );

    await waitFor(() => expect(areGrammarsRegistered(['source.tsx', 'source.css'])).toBe(true));
  });

  it("preloads every grammar with 'all'", async () => {
    render(
      <CodeProviderLazy preloadGrammars="all">
        <div />
      </CodeProviderLazy>,
    );

    await waitFor(() =>
      expect(areGrammarsRegistered(['source.tsx', 'source.css', 'source.yaml'])).toBe(true),
    );
  });
});
