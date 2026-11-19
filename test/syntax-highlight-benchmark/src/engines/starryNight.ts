import { createStarryNight } from '@wooorm/starry-night';
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
import sourceDiff from '@wooorm/starry-night/source.diff';
import type { Category } from '../categories';
import { isNumericText } from '../categories';
import type { Categorize, Engine } from '../engine';
import type { Language } from '../languages';
import { packageVersion } from '../packageVersion';

export const STARRY_NIGHT_GRAMMARS = [
  sourceJs,
  sourceTs,
  sourceTsx,
  sourceJson,
  textMd,
  sourceMdx,
  textHtmlBasic,
  sourceCss,
  sourceShell,
  sourceYaml,
  sourceDiff,
];

export const STARRY_NIGHT_SCOPES: Record<Language, string> = {
  js: 'source.js',
  ts: 'source.ts',
  tsx: 'source.tsx',
  json: 'source.json',
  md: 'text.md',
  mdx: 'source.mdx',
  html: 'text.html.basic',
  css: 'source.css',
  sh: 'source.shell',
  yaml: 'source.yaml',
  diff: 'source.diff',
};

const CATEGORY_BY_CLASS: Record<string, Category> = {
  'pl-c': 'comment',
  'pl-s': 'string',
  'pl-pds': 'string',
  'pl-sr': 'string',
  'pl-sra': 'string',
  'pl-sre': 'string',
  'pl-cce': 'string',
  'pl-k': 'keyword',
  'pl-en': 'function',
  'pl-ent': 'tag',
  'pl-e': 'attribute',
  'pl-smi': 'variable',
  'pl-v': 'variable',
  'pl-s1': 'variable',
  'pl-pse': 'punctuation',
  'pl-mh': 'markup',
  'pl-mb': 'markup',
  'pl-mi': 'markup',
  'pl-ml': 'markup',
  'pl-mq': 'markup',
  'pl-corl': 'markup',
  'pl-mdr': 'markup',
  'pl-ms': 'markup',
  'pl-mi1': 'inserted',
  'pl-mi2': 'inserted',
  'pl-md': 'deleted',
  'pl-mc': 'deleted',
};

const KEY_LANGUAGES = new Set<Language>(['json', 'yaml']);

export const categorizeStarryNight: Categorize = (className, text, language) => {
  if (className === 'pl-c1') {
    return isNumericText(text) ? 'number' : 'constant';
  }
  // GitHub's palette reuses the tag color for object keys and the attribute color for class, id and pseudo selectors.
  if (className === 'pl-ent' && KEY_LANGUAGES.has(language)) {
    return 'property';
  }
  if (className === 'pl-e' && language === 'css') {
    return 'tag';
  }
  // Operators share the keyword class.
  if (className === 'pl-k' && !/\w/.test(text)) {
    return 'punctuation';
  }
  return CATEGORY_BY_CLASS[className] ?? 'other';
};

type StarryNight = Awaited<ReturnType<typeof createStarryNight>>;

let instance: StarryNight | undefined;

export const starryNight: Engine = {
  name: 'starry-night',
  version: packageVersion('@wooorm/starry-night'),
  fallbacks: {},
  async init() {
    instance = await createStarryNight(STARRY_NIGHT_GRAMMARS);
  },
  highlight(source, language) {
    if (!instance) {
      throw new Error('starry-night is not initialized');
    }
    return instance.highlight(source, STARRY_NIGHT_SCOPES[language]);
  },
  categorize: categorizeStarryNight,
};
