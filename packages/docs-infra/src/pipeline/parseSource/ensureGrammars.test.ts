import { describe, it, expect, beforeEach } from 'vitest';
import type { Element, Root } from 'hast';
import { parseSource, createParseSource, resetHighlighter } from './parseSource';
import { ensureGrammars, areGrammarsRegistered } from './grammarCache';

// The highlighter is a global singleton; reset it so each test starts unloaded
// and exercises lazy loading from scratch.
beforeEach(() => {
  resetHighlighter();
});

/**
 * True when `parseSource` produced syntax-highlighted output (token `<span>`s on
 * the first line) rather than the plain-text fallback (a single text node) that
 * an unsupported file type falls back to.
 */
function highlightsAsCode(fileName: string, source: string): boolean {
  const root = parseSource(source, fileName) as Root;
  const frame = root.children[0];
  if (!frame || frame.type !== 'element') {
    return false;
  }
  const line = frame.children.find(
    (child): child is Element =>
      child.type === 'element' && (child.properties?.className?.includes('line') ?? false),
  );
  return Boolean(line?.children.some((child) => child.type === 'element'));
}

describe('ensureGrammars', () => {
  it('loads the engine, which highlights every supported language', async () => {
    await ensureGrammars(['source.css']);

    expect(highlightsAsCode('styles.css', 'a { color: red }')).toBe(true);
    expect(highlightsAsCode('index.js', 'const value = 1;')).toBe(true);
    expect(highlightsAsCode('Component.tsx', 'const value = <div />;')).toBe(true);
  });

  it('dedupes concurrent requests for the same scope', async () => {
    await Promise.all([
      ensureGrammars(['source.css']),
      ensureGrammars(['source.css']),
      ensureGrammars(['source.css']),
    ]);

    expect(highlightsAsCode('styles.css', 'a { color: red }')).toBe(true);
  });

  it('is idempotent across sequential calls and accumulates scopes', async () => {
    await ensureGrammars(['source.css']);
    await ensureGrammars(['source.css']);
    await ensureGrammars(['source.tsx']);

    expect(highlightsAsCode('styles.css', 'a { color: red }')).toBe(true);
    expect(highlightsAsCode('Component.tsx', 'const value = <div />;')).toBe(true);
  });

  it('ignores scopes the engine does not support', async () => {
    await expect(ensureGrammars(['source.nonexistent'])).resolves.toBeUndefined();
  });
});

describe('areGrammarsRegistered', () => {
  it('is false before anything is registered', () => {
    expect(areGrammarsRegistered(['source.css'])).toBe(false);
  });

  it('is true once the requested scopes are registered', async () => {
    await ensureGrammars(['source.css', 'source.tsx']);
    expect(areGrammarsRegistered(['source.css'])).toBe(true);
    expect(areGrammarsRegistered(['source.css', 'source.tsx'])).toBe(true);
  });

  it('is false when any requested scope is unsupported', async () => {
    await ensureGrammars(['source.css']);
    expect(areGrammarsRegistered(['source.css', 'source.yaml'])).toBe(true);
    expect(areGrammarsRegistered(['source.css', 'source.nonexistent'])).toBe(false);
  });

  it('is true for an empty scope list (nothing to wait for)', () => {
    expect(areGrammarsRegistered([])).toBe(true);
  });
});

describe('createParseSource', () => {
  it('with an explicit scope list loads the engine', async () => {
    await createParseSource(['source.css']);

    expect(highlightsAsCode('styles.css', 'a { color: red }')).toBe(true);
    expect(highlightsAsCode('index.ts', 'const value: number = 1;')).toBe(true);
  });

  it('with no arguments registers all grammars (eager / back-compat)', async () => {
    await createParseSource();

    expect(highlightsAsCode('styles.css', 'a { color: red }')).toBe(true);
    expect(highlightsAsCode('index.js', 'const value = 1;')).toBe(true);
    expect(highlightsAsCode('config.yaml', 'key: value')).toBe(true);
  });
});

describe('parseSource', () => {
  it('throws before the engine is loaded', () => {
    expect(() => parseSource('a { color: red }', 'styles.css')).toThrow(/not initialized/);
  });

  it('falls back to plain text for an unsupported file type', async () => {
    await createParseSource([]);
    expect(highlightsAsCode('notes.txt', 'plain words')).toBe(false);
  });
});
