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

const JAVASCRIPT_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'];
const JAVASCRIPT_LANGUAGES = ['js', 'javascript', 'jsx'];

/**
 * Whether a file is JavaScript rather than TypeScript.
 *
 * The whole JavaScript family shares the TypeScript grammar, so the scope
 * alone cannot tell the two apart. It has to be asked separately, because
 * `string` and `number` are ordinary variable names in JavaScript and type
 * names in TypeScript.
 */
export function isJavascriptSource(fileName?: string, language?: string): boolean {
  if (language) {
    return JAVASCRIPT_LANGUAGES.includes(language.toLowerCase());
  }
  if (!fileName) {
    return false;
  }
  const lowerCased = fileName.toLowerCase();
  return JAVASCRIPT_EXTENSIONS.some((extension) => lowerCased.endsWith(extension));
}

/**
 * Resolves language capabilities from a starry-night grammar scope string.
 *
 * Note: the JavaScript family maps to `source.tsx` via the extension map, so
 * there is no separate `source.js` or `source.jsx` scope in practice. MDX is
 * treated as JS+TS+JSX because it embeds TypeScript JSX.
 *
 * Pass the file the source came from to keep type syntax out of JavaScript:
 * without it a JavaScript file inherits `supportsTypes` from the shared
 * grammar, and `const string = 1` marks `string` as a built-in type.
 */
export function getLanguageCapabilitiesFromScope(
  grammarScope: string,
  source: { fileName?: string; language?: string } = {},
): LanguageCapabilities {
  const capabilities = getCapabilitiesForScope(grammarScope);
  if (capabilities.supportsTypes && isJavascriptSource(source.fileName, source.language)) {
    return { ...capabilities, supportsTypes: false };
  }
  return capabilities;
}

function getCapabilitiesForScope(grammarScope: string): LanguageCapabilities {
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
