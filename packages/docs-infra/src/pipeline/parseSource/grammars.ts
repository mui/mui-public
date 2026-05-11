/**
 * Heavy TextMate grammar payloads. Importing this module pulls in hundreds of
 * KB of JSON. Prefer `await import('./grammars')` so bundlers can code-split
 * it into its own chunk.
 *
 * Lightweight extension/language maps live in `./grammarMaps.ts`.
 */

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
