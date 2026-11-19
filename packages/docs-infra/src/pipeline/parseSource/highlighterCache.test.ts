import { describe, it, expect, beforeEach } from 'vitest';
import type { Element, Root } from 'hast';
import { parseSource, createParseSource, resetHighlighter } from './parseSource';
import { isHighlighterLoaded, loadHighlighter } from './highlighterCache';

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

describe('loadHighlighter', () => {
  it('loads the engine, which highlights every supported language', async () => {
    await loadHighlighter();

    expect(highlightsAsCode('styles.css', 'a { color: red }')).toBe(true);
    expect(highlightsAsCode('index.js', 'const value = 1;')).toBe(true);
    expect(highlightsAsCode('Component.tsx', 'const value = <div />;')).toBe(true);
    expect(highlightsAsCode('config.yaml', 'key: value')).toBe(true);
  });

  it('dedupes concurrent loads', async () => {
    await Promise.all([loadHighlighter(), loadHighlighter(), loadHighlighter()]);

    expect(highlightsAsCode('styles.css', 'a { color: red }')).toBe(true);
  });

  it('is idempotent across sequential calls', async () => {
    await loadHighlighter();
    await loadHighlighter();

    expect(isHighlighterLoaded()).toBe(true);
  });
});

describe('isHighlighterLoaded', () => {
  it('is false before the engine loads', () => {
    expect(isHighlighterLoaded()).toBe(false);
  });

  it('is true once createParseSource has loaded the engine', async () => {
    await createParseSource();
    expect(isHighlighterLoaded()).toBe(true);
  });
});

describe('parseSource', () => {
  it('throws before the engine is loaded', () => {
    expect(() => parseSource('a { color: red }', 'styles.css')).toThrow(/not initialized/);
  });

  it('falls back to plain text for an unsupported file type', async () => {
    await createParseSource();
    expect(highlightsAsCode('notes.txt', 'plain words')).toBe(false);
  });
});
