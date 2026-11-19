import type { Parser } from '@lezer/common';
import { highlightCode, tagHighlighter, tags } from '@lezer/highlight';

const highlighter = tagHighlighter([
  { tag: tags.comment, class: 'comment' },
  { tag: tags.string, class: 'string' },
  { tag: tags.keyword, class: 'keyword' },
]);

export const loaders = {
  js: () => import('./lezer/js'),
  ts: () => import('./lezer/ts'),
  tsx: () => import('./lezer/tsx'),
  json: () => import('./lezer/json'),
  md: () => import('./lezer/md'),
  mdx: () => import('./lezer/mdx'),
  html: () => import('./lezer/html'),
  css: () => import('./lezer/css'),
  sh: () => import('./lezer/sh'),
  yaml: () => import('./lezer/yaml'),
  diff: () => import('./lezer/diff'),
};

export const highlight = (
  source: string,
  parser: Parser,
  putText: (text: string, classes: string) => void,
) => highlightCode(source, parser.parse(source), highlighter, putText, () => putText('\n', ''));
