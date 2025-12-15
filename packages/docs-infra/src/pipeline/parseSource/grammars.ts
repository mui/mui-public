import sourceJs from '@wooorm/starry-night/source.js';
import sourceTs from '@wooorm/starry-night/source.ts';
import sourceTsx from '@wooorm/starry-night/source.tsx';
import sourceJson from '@wooorm/starry-night/source.json';
import textMd from '@wooorm/starry-night/text.md';
import sourceMdx from '@wooorm/starry-night/source.mdx';
import textHtmlBasic from '@wooorm/starry-night/text.html.basic';
import sourceCss from '@wooorm/starry-night/source.css';
import sourceShell from '@wooorm/starry-night/source.shell';
import sourceYaml from '@wooorm/starry-night/source.yaml';

export const grammars = [
  sourceJs,
  sourceTs,
  sourceTsx,
  sourceJson,
  textMd,
  sourceMdx, // needs sourceTsx
  textHtmlBasic,
  sourceCss,
  sourceShell,
  sourceYaml,
];

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
