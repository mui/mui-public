/**
 * @vitest-environment jsdom
 *
 * The `preloadGrammars` provider opt-in: omitted leaves grammars fully lazy;
 * a language/scope list warms exactly those on mount; `'all'` warms everything.
 */
import * as React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// eslint-disable-next-line testing-library/no-manual-cleanup -- root vitest config does not set `globals: true`, so RTL's auto cleanup is a no-op here.
import { render, cleanup, waitFor } from '@testing-library/react';
import { CodeProviderLazy } from './CodeProviderLazy';
import { areGrammarsRegistered } from '../pipeline/parseSource/grammarCache';
import { resetStarryNight } from '../pipeline/parseSource/parseSource';

beforeEach(() => {
  resetStarryNight();
});

afterEach(cleanup);

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

  it('preloads exactly the listed languages on mount', async () => {
    render(
      <CodeProviderLazy preloadGrammars={['tsx', 'css']}>
        <div />
      </CodeProviderLazy>,
    );

    await waitFor(() => expect(areGrammarsRegistered(['source.tsx', 'source.css'])).toBe(true));
    // An unlisted language stays unregistered.
    expect(areGrammarsRegistered(['source.yaml'])).toBe(false);
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
