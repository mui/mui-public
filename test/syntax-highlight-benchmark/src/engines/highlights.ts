import { codeToTokens } from '@pierre/highlights';
import type { Lang, Theme } from '@pierre/highlights';
import type { Categorize, Engine } from '../engine';
import { linesToHast } from '../hast';
import type { Language } from '../languages';
import { packageVersion } from '../packageVersion';

/** With CSS-variable colors every token's color is `var(--hls-{token-type})`, exposing the token type. */
const TOKEN_TYPE_THEME: Theme = {
  name: 'token-types',
  appearance: 'light',
  style: {},
  cssVariables: true,
};

const COLOR_PREFIX = 'var(--hls-';

const LANGS: Record<Language, Lang> = {
  js: 'js',
  ts: 'ts',
  tsx: 'tsx',
  json: 'json',
  md: 'md',
  mdx: 'mdx',
  html: 'html',
  css: 'css',
  sh: 'sh',
  yaml: 'yaml',
  diff: 'diff',
};

const PLAIN_TYPES = new Set(['none', 'foreground', 'text-jsx', 'embedded']);

function tokenType(color: string | undefined): string | undefined {
  if (!color?.startsWith(COLOR_PREFIX)) {
    return undefined;
  }
  const type = color.slice(COLOR_PREFIX.length, -1);
  return PLAIN_TYPES.has(type) ? undefined : type;
}

export const categorizeHighlights: Categorize = (className) => {
  const type = className.slice('hl-'.length);
  const head = type.split('-')[0];
  if (type === 'diff-plus') {
    return 'inserted';
  }
  if (type === 'diff-minus') {
    return 'deleted';
  }
  // Inline code, which GitHub's palette colors as a constant.
  if (type === 'text-literal') {
    return 'constant';
  }
  if (type === 'punctuation-markup' || type === 'punctuation-list-marker') {
    return 'markup';
  }
  switch (head) {
    case 'comment':
      return 'comment';
    case 'string':
      return 'string';
    case 'keyword':
      return 'keyword';
    case 'number':
      return 'number';
    case 'constant':
    case 'boolean':
    case 'enum':
      return 'constant';
    case 'function':
    case 'constructor':
      return 'function';
    case 'type':
    case 'namespace':
      return 'type';
    case 'tag':
    case 'selector':
      return 'tag';
    case 'attribute':
      return 'attribute';
    case 'property':
      return 'property';
    case 'variable':
    case 'label':
      return 'variable';
    case 'punctuation':
    case 'operator':
      return 'punctuation';
    case 'title':
    case 'emphasis':
    case 'link':
      return 'markup';
    default:
      return 'other';
  }
};

export const highlights: Engine = {
  name: '@pierre/highlights',
  version: packageVersion('@pierre/highlights'),
  fallbacks: {},
  async init() {
    codeToTokens('', { lang: 'plain', theme: TOKEN_TYPE_THEME });
  },
  highlight(source, language) {
    const { tokens } = codeToTokens(source, { lang: LANGS[language], theme: TOKEN_TYPE_THEME });
    return linesToHast(
      tokens.map((line) =>
        line.map((token) => {
          const type = tokenType(token.color);
          return { text: token.content, className: type ? `hl-${type}` : undefined };
        }),
      ),
    );
  },
  categorize: categorizeHighlights,
};
