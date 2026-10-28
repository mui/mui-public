import type * as React from 'react';
import { describe, it, expect } from 'vitest';
import type { Root as HastRoot } from 'hast';
import { CodeHighlighter } from './CodeHighlighter';
import { CodeHighlighterChunk } from './CodeHighlighterChunk';
import * as Errors from './errors';
import type { Code, CodeHighlighterProps, ContentProps, ContentLoadingProps } from './types';

const hast: HastRoot = { type: 'root', children: [{ type: 'text', value: 'x' }] };

/** A fully-highlighted variant. */
const loaded = { source: { hast } };
/** A source-only (not yet highlighted) variant. */
const sourceOnly = { source: 'const a = 1;' };
/** A variant that exists but whose source must still be loaded (from its URL). */
const unloaded = { fileName: 'a.ts', url: 'a.ts' };

function Content(_props: ContentProps<{}>) {
  return null;
}
function ContentLoading(_props: ContentLoadingProps<{}>) {
  return null;
}

const loaderFns = { loadCodeMeta: async () => ({}) as Code };

/** Render `CodeHighlighter` as a plain function and read the routed chunk element. */
function chunkOf(props: Partial<CodeHighlighterProps<{}>>) {
  const element = CodeHighlighter({ Content, ...props } as CodeHighlighterProps<{}>);
  return element as React.ReactElement<{
    preloaded?: Code;
    controlled?: boolean;
    isInitial?: boolean;
    forceClient?: boolean;
    skipInitialLoad?: boolean;
    awaitServerLoad?: boolean;
    userProps: { fallback?: React.ReactNode };
  }>;
}

describe('CodeHighlighter routing onto the chunk', () => {
  it('routes to CodeHighlighterChunk', () => {
    const element = chunkOf({ precompute: { Default: loaded } as unknown as Code });
    expect(element.type).toBe(CodeHighlighterChunk);
  });

  describe('validation throws', () => {
    it('throws when both children and code are provided', () => {
      expect(() =>
        CodeHighlighter({
          Content,
          children: 'x',
          code: { Default: loaded } as unknown as Code,
        } as CodeHighlighterProps<{}>),
      ).toThrow(Errors.ErrorCodeHighlighterServerInvalidProps);
    });

    it('throws when there are no variants', () => {
      expect(() => CodeHighlighter({ Content } as CodeHighlighterProps<{}>)).toThrow(
        Errors.ErrorCodeHighlighterServerMissingData,
      );
    });

    it('throws when highlightAfter is stream without a ContentLoading', () => {
      expect(() =>
        chunkOf({ precompute: { Default: loaded } as unknown as Code, highlightAfter: 'stream' }),
      ).toThrow(Errors.ErrorCodeHighlighterServerMissingContentLoading);
    });

    it('throws InvalidClientMode when no initial can load and highlightAfter is init', () => {
      // Variant exists but its source is unloaded (-> no initial data) and there
      // are no loader fns (-> forced client), with highlightAfter 'init'.
      expect(() =>
        chunkOf({
          ContentLoading,
          code: { Default: unloaded } as unknown as Code,
          highlightAfter: 'init',
        }),
      ).toThrow(Errors.ErrorCodeHighlighterServerInvalidClientMode);
    });
  });

  describe('content (no ContentLoading)', () => {
    it('renders content directly (controlled) and skips the initial loader, with no fallback', () => {
      const { props } = chunkOf({ precompute: { Default: loaded } as unknown as Code });
      expect(props.controlled).toBe(true);
      expect(props.skipInitialLoad).toBe(true);
      expect(props.userProps.fallback).toBeUndefined();
    });
  });

  describe('with a ContentLoading', () => {
    it('all variants loaded -> controlled, fallback prepared', () => {
      const { props } = chunkOf({
        ContentLoading,
        precompute: { Default: loaded } as unknown as Code,
      });
      expect(props.controlled).toBe(true);
      expect(props.skipInitialLoad).toBe(false);
      expect(props.userProps.fallback).toBeTruthy();
    });

    it('partial code + loader fns -> isInitial, server-loadable, fallback prepared', () => {
      const { props } = chunkOf({
        ContentLoading,
        code: { Default: sourceOnly, Other: sourceOnly } as unknown as Code,
        ...loaderFns,
      });
      expect(props.controlled).toBe(false);
      expect(props.isInitial).toBe(true);
      expect(props.forceClient).toBe(false);
      expect(props.userProps.fallback).toBeTruthy();
    });

    it('partial code + no loader fns -> isInitial but forced client', () => {
      const { props } = chunkOf({
        ContentLoading,
        code: { Default: sourceOnly, Other: sourceOnly } as unknown as Code,
      });
      expect(props.isInitial).toBe(true);
      expect(props.forceClient).toBe(true);
      expect(props.userProps.fallback).toBeTruthy();
    });

    it('variant present but source unloaded + loader fns -> server-initial (not initial, not forced), no fallback yet', () => {
      const { props } = chunkOf({
        ContentLoading,
        code: { Default: unloaded } as unknown as Code,
        ...loaderFns,
      });
      expect(props.isInitial).toBe(false);
      expect(props.forceClient).toBe(false);
      expect(props.skipInitialLoad).toBe(false);
      expect(props.userProps.fallback).toBeUndefined();
    });
  });
});
