/**
 * Language capabilities derived from a grammar scope or language class.
 *
 * Shared by both `extendSyntaxTokens` (which receives grammar scopes like
 * `'source.tsx'`) and `enhanceCodeTypes` (which reads `language-*` CSS classes).
 */
export interface LanguageCapabilities {
  /** Whether `type Name` and `const name: Name =` syntax is recognized. */
  supportsTypes: boolean;
  /** Whether JSX `<Component prop={}>` syntax is recognized. */
  supportsJsx: boolean;
  /**
   * Which platform semantics apply: `'js'` for function calls / JS patterns,
   * `'css'` for CSS patterns, or `undefined` for unknown languages.
   */
  semantics?: 'js' | 'css';
}

const BASE_CAPABILITIES: LanguageCapabilities = {
  supportsTypes: false,
  supportsJsx: false,
};

/**
 * Resolves language capabilities from a starry-night grammar scope string.
 *
 * Note: `.jsx` files map to `source.tsx` via the extension map, so there is
 * no separate `source.jsx` scope. MDX is treated as JS+TS+JSX because it
 * embeds TypeScript JSX.
 */
export function getLanguageCapabilitiesFromScope(grammarScope: string): LanguageCapabilities {
  switch (grammarScope) {
    case 'source.js':
      return { supportsTypes: false, supportsJsx: false, semantics: 'js' };
    case 'source.ts':
      return { supportsTypes: true, supportsJsx: false, semantics: 'js' };
    case 'source.tsx':
      return { supportsTypes: true, supportsJsx: true, semantics: 'js' };
    case 'source.mdx':
      return { supportsTypes: true, supportsJsx: true, semantics: 'js' };
    case 'source.css':
      return { supportsTypes: false, supportsJsx: false, semantics: 'css' };
    default:
      return BASE_CAPABILITIES;
  }
}
