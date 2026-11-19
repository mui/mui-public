/**
 * Light-weight language maps. These can be statically imported without
 * pulling in the highlighting engine (`./highlightToHast`, loaded via dynamic
 * `import()` so the bundler can code-split it into its own chunk).
 */

/** A language the highlighting engine supports. */
export type HighlightLanguage =
  'js' | 'ts' | 'tsx' | 'json' | 'md' | 'mdx' | 'html' | 'css' | 'sh' | 'yaml' | 'diff';

/** Maps file extensions to the language that highlights them. */
export const extensionMap: Record<string, HighlightLanguage> = {
  '.js': 'js',
  '.ts': 'ts',
  '.jsx': 'tsx',
  '.tsx': 'tsx',
  '.json': 'json',
  '.md': 'md',
  '.mdx': 'mdx',
  '.html': 'html',
  '.css': 'css',
  '.sh': 'sh',
  '.yaml': 'yaml',
};

/**
 * Maps language names and aliases to the language that highlights them.
 * Used when `language` prop is provided instead of fileName.
 */
export const languageAliasMap: Record<string, HighlightLanguage> = {
  diff: 'diff',
  js: 'js',
  javascript: 'js',
  ts: 'ts',
  typescript: 'ts',
  jsx: 'tsx',
  tsx: 'tsx',
  json: 'json',
  md: 'md',
  markdown: 'md',
  mdx: 'mdx',
  html: 'html',
  css: 'css',
  sh: 'sh',
  shell: 'sh',
  bash: 'sh',
  yaml: 'yaml',
  yml: 'yaml',
};

/**
 * Normalizes a language name or alias to a supported language.
 * @param language - The language name (for example, 'tsx', 'css', 'typescript')
 * @returns The supported language, or undefined if not recognized
 */
export function normalizeLanguage(language: string): HighlightLanguage | undefined {
  return languageAliasMap[language.toLowerCase()];
}

/**
 * Resolves the language to highlight from a file's name and/or explicit
 * language, preferring `language` and falling back to the file extension. This
 * is the single source of truth for how `parseSource` and the editor pick a
 * language.
 *
 * @param fileName - File name used to detect language via its extension
 * @param language - Optional explicit language override (e.g., 'tsx', 'css')
 * @returns The supported language, or undefined for unsupported / unknown inputs
 */
export function resolveLanguage(
  fileName?: string,
  language?: string,
): HighlightLanguage | undefined {
  if (language) {
    const normalized = normalizeLanguage(language);
    if (normalized) {
      return normalized;
    }
  }
  if (fileName) {
    const fileType = fileName.slice(fileName.lastIndexOf('.'));
    return extensionMap[fileType];
  }
  return undefined;
}
