/**
 * Light-weight grammar metadata maps. These can be statically imported without
 * pulling in the heavy TextMate grammar JSON payloads (which live in
 * `./grammars.ts` and should be loaded via dynamic `import('./grammars')` so
 * the bundler can code-split them into their own chunk).
 */

export const extensionMap: Record<string, string> = {
  '.js': 'source.js',
  '.ts': 'source.ts',
  '.jsx': 'source.tsx',
  '.tsx': 'source.tsx',
  '.json': 'source.json',
  '.md': 'text.md',
  '.mdx': 'source.mdx',
  '.html': 'text.html.basic',
  '.css': 'source.css',
  '.sh': 'source.shell',
  '.yaml': 'source.yaml',
};

/**
 * Maps simplified language names back to grammar scope names.
 * Used when `language` prop is provided instead of fileName.
 */
export const languageToGrammarMap: Record<string, string> = {
  js: 'source.js',
  javascript: 'source.js',
  ts: 'source.ts',
  typescript: 'source.ts',
  jsx: 'source.tsx',
  tsx: 'source.tsx',
  json: 'source.json',
  md: 'text.md',
  markdown: 'text.md',
  mdx: 'source.mdx',
  html: 'text.html.basic',
  css: 'source.css',
  sh: 'source.shell',
  shell: 'source.shell',
  bash: 'source.shell',
  yaml: 'source.yaml',
  yml: 'source.yaml',
};

/**
 * Gets the grammar scope from a language name.
 * @param language - The language name (e.g., 'tsx', 'css', 'typescript')
 * @returns The grammar scope or undefined if not recognized
 */
export function getGrammarFromLanguage(language: string): string | undefined {
  return languageToGrammarMap[language.toLowerCase()];
}

/**
 * Resolves a grammar scope from a file's name and/or explicit language,
 * preferring `language` and falling back to the file extension. This is the
 * single source of truth for how `parseSource` picks a grammar and how
 * `detectGrammarScopes` enumerates the grammars a code block needs, so the two
 * never disagree.
 *
 * @param fileName - File name used to detect language via its extension
 * @param language - Optional explicit language override (e.g., 'tsx', 'css')
 * @returns The grammar scope, or undefined for unsupported / unknown inputs
 */
export function resolveGrammarScope(fileName?: string, language?: string): string | undefined {
  if (language) {
    const scope = getGrammarFromLanguage(language);
    if (scope) {
      return scope;
    }
  }
  if (fileName) {
    const fileType = fileName.slice(fileName.lastIndexOf('.'));
    return extensionMap[fileType];
  }
  return undefined;
}

/**
 * Normalizes a user-supplied list (the `preloadGrammars` provider prop) to
 * grammar scope names, accepting either language names (`'tsx'`, `'typescript'`)
 * or scope names (`'source.tsx'`) and de-duplicating. Entries that match neither
 * are passed through as-is, so an unrecognized scope is simply ignored
 * downstream (it has no loader) rather than throwing.
 */
export function normalizeToScopes(entries: string[]): string[] {
  return [...new Set(entries.map((entry) => getGrammarFromLanguage(entry) ?? entry))];
}
