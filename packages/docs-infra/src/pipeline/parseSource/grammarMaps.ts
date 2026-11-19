/**
 * Light-weight grammar metadata maps. These can be statically imported without
 * pulling in the highlighting engine (`./highlightToHast`, loaded via dynamic
 * `import()` so the bundler can code-split it into its own chunk).
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
  diff: 'source.diff',
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
 * @param language - The language name (for example, 'tsx', 'css', 'typescript')
 * @returns The grammar scope or undefined if not recognized
 */
export function getGrammarFromLanguage(language: string): string | undefined {
  return languageToGrammarMap[language.toLowerCase()];
}

/**
 * Resolves a grammar scope from a file's name and/or explicit language,
 * preferring `language` and falling back to the file extension. This is the
 * single source of truth for how `parseSource` and the editor pick a grammar.
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
