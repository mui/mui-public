import { describe, it, expect, beforeEach } from 'vitest';
import type { Element, Root } from 'hast';
import { parseSource, createParseSource, resetStarryNight } from './parseSource';
import { ensureGrammars, areGrammarsRegistered } from './grammarCache';

// The Starry Night instance is a global singleton; reset it so each test starts
// from a known-empty registry and exercises lazy registration from scratch.
beforeEach(() => {
  resetStarryNight();
});

/**
 * True when `parseSource` produced syntax-highlighted output (token `<span>`s on
 * the first line) rather than the plain-text fallback (a single text node) that
 * a scope whose grammar isn't registered falls back to.
 */
function highlightsAsCode(fileName: string, source: string): boolean {
  const root = parseSource(source, fileName) as Root;
  const frame = root.children[0];
  if (!frame || frame.type !== 'element') {
    return false;
  }
  const line = frame.children.find(
    (child): child is Element =>
      child.type === 'element' &&
      (Array.isArray(child.properties?.className)
        ? child.properties.className.includes('line')
        : child.properties?.className === 'line'),
  );
  return Boolean(line?.children.some((child) => child.type === 'element'));
}

describe('ensureGrammars', () => {
  it('registers only the requested scope, leaving others as plain-text fallback', async () => {
    await ensureGrammars(['source.css']);

    expect(highlightsAsCode('styles.css', 'a { color: red }')).toBe(true);
    // js was never requested, so its grammar isn't registered -> plain-text fallback.
    expect(highlightsAsCode('index.js', 'const value = 1;')).toBe(false);
  });

  it('auto-resolves a grammar dependency (source.mdx needs source.tsx)', async () => {
    await ensureGrammars(['source.mdx']);

    // tsx was never requested, but mdx depends on it, so it is registered too.
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

  it('ignores scopes it has no loader for', async () => {
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

  it('is false when any requested scope is missing', async () => {
    await ensureGrammars(['source.css']);
    expect(areGrammarsRegistered(['source.css', 'source.yaml'])).toBe(false);
  });

  it('is true for an empty scope list (nothing to wait for)', () => {
    expect(areGrammarsRegistered([])).toBe(true);
  });
});

describe('createParseSource (subset)', () => {
  it('with an explicit scope list registers only that subset', async () => {
    await createParseSource(['source.css']);

    expect(highlightsAsCode('styles.css', 'a { color: red }')).toBe(true);
    expect(highlightsAsCode('index.ts', 'const value: number = 1;')).toBe(false);
  });

  it('with no arguments registers all grammars (eager / back-compat)', async () => {
    await createParseSource();

    expect(highlightsAsCode('styles.css', 'a { color: red }')).toBe(true);
    expect(highlightsAsCode('index.js', 'const value = 1;')).toBe(true);
    expect(highlightsAsCode('config.yaml', 'key: value')).toBe(true);
  });
});

describe('parseSource cold-grammar fallback', () => {
  it('falls back to plain text for a mapped-but-unregistered scope, then highlights once ensured', async () => {
    // Empty instance: `.css` maps to source.css, but its grammar isn't registered.
    await createParseSource([]);
    expect(highlightsAsCode('styles.css', 'a { color: red }')).toBe(false);

    // After ensuring the scope, the same input highlights.
    await ensureGrammars(['source.css']);
    expect(highlightsAsCode('styles.css', 'a { color: red }')).toBe(true);
  });
});
