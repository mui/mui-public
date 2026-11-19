import type { Engine } from '../engine';
import { linesToHast } from '../hast';
import { packageVersion } from '../packageVersion';
import { categorizeCodemirror, tokenizeCodemirror } from './codemirrorLanguages';

export const codemirror: Engine = {
  name: 'CodeMirror (Lezer)',
  version: `@lezer/highlight ${packageVersion('@lezer/highlight')}`,
  fallbacks: {
    mdx: 'Markdown with JSX blocks',
    sh: 'legacy stream mode',
    diff: 'legacy stream mode',
  },
  init: () => Promise.resolve(),
  highlight: (source, language) => linesToHast(tokenizeCodemirror(source, language)),
  categorize: categorizeCodemirror,
};
