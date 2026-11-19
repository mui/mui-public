/**
 * Language capabilities derived from a highlight language or language class.
 *
 * Shared by both `extendSyntaxTokens` (which receives highlight languages like
 * `'tsx'`) and `enhanceCodeTypes` (which reads `language-*` CSS classes).
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
 * Resolves language capabilities from a highlight language.
 *
 * Note: `.jsx` files map to `tsx` via the extension map, so there is
 * no separate `jsx` language. MDX is treated as JS+TS+JSX because it
 * embeds TypeScript JSX.
 */
export function capabilitiesForLanguage(language: string): LanguageCapabilities {
  switch (language) {
    case 'js':
      return { supportsTypes: false, supportsJsx: false, semantics: 'js' };
    case 'ts':
      return { supportsTypes: true, supportsJsx: false, semantics: 'js' };
    case 'tsx':
      return { supportsTypes: true, supportsJsx: true, semantics: 'js' };
    case 'mdx':
      return { supportsTypes: true, supportsJsx: true, semantics: 'js' };
    case 'css':
      return { supportsTypes: false, supportsJsx: false, semantics: 'css' };
    default:
      return BASE_CAPABILITIES;
  }
}
