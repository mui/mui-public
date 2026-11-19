import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';
import type { Engine } from '../engine';
import { packageVersion } from '../packageVersion';
import { categorizeStarryNight } from './starryNight';

type ParseSource = Awaited<ReturnType<typeof createParseSource>>;

let parse: ParseSource | undefined;

/**
 * The production docs-infra path: starry-night plus `extendSyntaxTokens` and
 * line gutters. Shows how much of `parseSource` the engine itself accounts for.
 */
export const docsInfra: Engine = {
  name: 'docs-infra parseSource',
  version: `starry-night ${packageVersion('@wooorm/starry-night')}`,
  fallbacks: {},
  async init() {
    parse = await createParseSource();
  },
  highlight(source, language) {
    if (!parse) {
      throw new Error('docs-infra parseSource is not initialized');
    }
    return parse(source, `file.${language}`, language);
  },
  categorize: categorizeStarryNight,
};
