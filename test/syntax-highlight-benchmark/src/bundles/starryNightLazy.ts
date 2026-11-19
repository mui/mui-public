import { createStarryNight } from '@wooorm/starry-night';
import type { Grammar } from '@wooorm/starry-night';

export const loaders = {
  js: () => import('@wooorm/starry-night/source.js'),
  ts: () => import('@wooorm/starry-night/source.ts'),
  tsx: () => import('@wooorm/starry-night/source.tsx'),
  json: () => import('@wooorm/starry-night/source.json'),
  md: () => import('@wooorm/starry-night/text.md'),
  mdx: () => import('@wooorm/starry-night/source.mdx'),
  html: () => import('@wooorm/starry-night/text.html.basic'),
  css: () => import('@wooorm/starry-night/source.css'),
  sh: () => import('@wooorm/starry-night/source.shell'),
  yaml: () => import('@wooorm/starry-night/source.yaml'),
  diff: () => import('@wooorm/starry-night/source.diff'),
};

export const create = (grammars: Grammar[]) => createStarryNight(grammars);
