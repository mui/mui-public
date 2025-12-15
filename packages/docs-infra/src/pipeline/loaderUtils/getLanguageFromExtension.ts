/**
 * Maps file extensions to language names.
 * These are user-friendly names that can be used in the `language` prop.
 */
export const languageMap: Record<string, string> = {
  '.js': 'javascript',
  '.ts': 'typescript',
  '.jsx': 'jsx',
  '.tsx': 'tsx',
  '.json': 'json',
  '.md': 'markdown',
  '.mdx': 'mdx',
  '.html': 'html',
  '.css': 'css',
  '.sh': 'shell',
  '.yaml': 'yaml',
};

/**
 * Maps language aliases to canonical language names.
 * Used to normalize short language names (e.g., from className like 'language-js')
 * to their full names.
 */
export const languageAliasMap: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  javascript: 'javascript',
  typescript: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'mdx',
  html: 'html',
  css: 'css',
  sh: 'shell',
  bash: 'shell',
  shell: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
};

/**
 * Gets the language name from a file extension.
 * @param extension - The file extension (e.g., '.tsx', '.css')
 * @returns The language name or undefined if not recognized
 */
export function getLanguageFromExtension(extension: string): string | undefined {
  return languageMap[extension];
}

/**
 * Normalizes a language name to its canonical form.
 * This handles aliases like 'js' -> 'javascript', 'ts' -> 'typescript'.
 * @param language - The language name or alias
 * @returns The canonical language name, or the input if not a known alias
 */
export function normalizeLanguage(language: string): string {
  return languageAliasMap[language] ?? language;
}
