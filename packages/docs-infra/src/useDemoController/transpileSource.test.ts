import { describe, it, expect } from 'vitest';
import { transpileSource } from './transpileSource';
import { transformCode } from './transformCode';
import { SCOPE_IMPORT_PREFIX } from './constants';

const P = SCOPE_IMPORT_PREFIX;

describe('transpileSource', () => {
  it('transpiles TS/JSX to CommonJS (sucrase), stripping types', () => {
    const out = transpileSource('const x: number = 1;\nexport const y = <div />;');
    expect(out).not.toContain(': number');
    expect(out).toContain('React.createElement');
    expect(out).toContain('exports.y');
  });

  it('equals `transformCode` when given no options (the bare transpile)', () => {
    const source = "import { a } from 'lib';\nexport const b = a + 1;";
    expect(transpileSource(source)).toBe(transformCode(source));
  });

  it('promotes a bare leading expression to a default export only when `normalize`', () => {
    // sucrase emits `exports. default` (a space before the reserved word).
    expect(transpileSource('<span>hi</span>')).not.toMatch(/exports\.\s*default/);
    expect(transpileSource('<span>hi</span>', { normalize: true })).toMatch(
      /exports\.\s*default\s*=/,
    );
  });

  it('rewrites relative imports to absolute scope keys when `nested`', () => {
    const out = transpileSource("import { x } from '../lib/util';\nexport const y = x;", {
      fileName: 'feature/use.ts',
      nested: true,
    });
    // sucrase turns the import into a require of the absolutized specifier.
    expect(out).toContain(`${P}lib/util`);
    expect(out).not.toContain('../lib/util');
  });

  it('leaves relative imports untouched when not `nested`', () => {
    // `x` is used so the TS transform keeps the (here, un-rewritten) require.
    const out = transpileSource("import { x } from './sibling';\nexport const y = x;", {
      fileName: 'file.ts',
    });
    expect(out).toContain('./sibling');
    expect(out).not.toContain(P);
  });

  it('absolutizes a nested entry while leaving an explicit default export intact', () => {
    // A realistic nested entry leads with an import, so `normalize` is a no-op
    // (the leading-expression promotion only fires when nothing precedes it); the
    // explicit default export must survive and the import must be absolutized.
    const out = transpileSource("import { x } from './lib/util';\nexport default () => x;", {
      fileName: 'index.tsx',
      nested: true,
      normalize: true,
    });
    expect(out).toContain(`${P}lib/util`); // absolutized
    expect(out).toMatch(/exports\.\s*default\s*=/); // explicit default export survives
  });
});
