import { describe, it, expect } from 'vitest';
import { transformCode, normalizeCode } from './transformCode';

describe('transformCode', () => {
  it('strips TypeScript annotations', () => {
    const out = transformCode('const total: number = 1 + 2;');
    expect(out).not.toContain(': number');
    expect(out).toContain('const total = 1 + 2');
  });

  it('compiles JSX with the classic runtime, so React must be in scope', () => {
    expect(transformCode('<div>hi</div>')).toContain('React.createElement');
  });

  it('downlevels import statements to require calls', () => {
    const out = transformCode("import Button from 'ui';\nexport default Button;");
    expect(out).toContain("require('ui')");
  });

  it('removes the leading "use strict" prologue sucrase adds', () => {
    expect(transformCode('const value = 1;').startsWith('"use strict"')).toBe(false);
  });

  it('produces runnable code whose exports can be read back', () => {
    const out = transformCode('export const answer = 42;');
    const exports: Record<string, unknown> = {};
    // eslint-disable-next-line no-new-func
    new Function('exports', out)(exports);
    expect(exports.answer).toBe(42);
  });
});

describe('normalizeCode', () => {
  it('prepends export default to a leading JSX element', () => {
    expect(normalizeCode('<Button />')).toBe('export default <Button />');
  });

  it('prepends export default to a leading function', () => {
    expect(normalizeCode('function App() { return null; }')).toBe(
      'export default function App() { return null; }',
    );
  });

  it('prepends export default to a leading zero-argument arrow function', () => {
    expect(normalizeCode('() => <div />')).toBe('export default () => <div />');
  });

  it('prepends export default to a leading class', () => {
    expect(normalizeCode('class App {}')).toBe('export default class App {}');
  });

  it('preserves leading whitespace', () => {
    expect(normalizeCode('   <Button />')).toBe('   export default <Button />');
  });

  it('only rewrites the first line, leaving later lines untouched', () => {
    expect(normalizeCode('<div>\n  <span />\n</div>')).toBe(
      'export default <div>\n  <span />\n</div>',
    );
  });

  it('leaves a source that already declares its export unchanged', () => {
    const source = 'export default function App() {}';
    expect(normalizeCode(source)).toBe(source);
  });

  it('leaves a non-renderable leading statement unchanged', () => {
    expect(normalizeCode('const value = 1;')).toBe('const value = 1;');
    expect(normalizeCode("import Button from 'ui';")).toBe("import Button from 'ui';");
  });
});
