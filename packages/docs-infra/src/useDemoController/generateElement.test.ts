import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { generateElement } from './generateElement';

describe('generateElement', () => {
  it('returns null for empty or whitespace-only code', () => {
    expect(generateElement({ code: '' })).toBeNull();
    expect(generateElement({ code: '   \n  ' })).toBeNull();
  });

  it('renders a bare leading JSX element as the default export', () => {
    expect(React.isValidElement(generateElement({ code: '<div>hi</div>' }))).toBe(true);
  });

  it('instantiates a default-exported component with no props', () => {
    const element = generateElement({ code: 'export default function App() { return null; }' });
    expect(React.isValidElement(element)).toBe(true);
    if (React.isValidElement(element)) {
      expect(typeof element.type).toBe('function');
    }
  });

  it('returns a default-exported string verbatim', () => {
    expect(generateElement({ code: 'export default "plain text";' })).toBe('plain text');
  });

  it('supports assigning the default via the injected render callback', () => {
    expect(
      React.isValidElement(generateElement({ code: 'render(<span>via render</span>);' })),
    ).toBe(true);
  });

  it('returns null when the default export is falsy', () => {
    expect(generateElement({ code: 'export default null;' })).toBeNull();
    expect(generateElement({ code: 'export default 0;' })).toBeNull();
  });

  it('resolves imports from the scope registry', () => {
    const element = generateElement({
      code: "import { label } from 'consts';\nexport default <button>{label}</button>;",
      scope: { import: { consts: { label: 'Click' } } },
    });
    expect(React.isValidElement(element)).toBe(true);
  });

  it('keeps the injected render callback even when scope defines `render`', () => {
    // The injected `render` escape hatch must win over a same-named scope entry —
    // otherwise `render(...)` would call the (non-callable) scope value and throw.
    const element = generateElement({
      code: 'render(<span>via render</span>);',
      scope: { import: {}, render: 'not a function' },
    });
    expect(React.isValidElement(element)).toBe(true);
  });
});
