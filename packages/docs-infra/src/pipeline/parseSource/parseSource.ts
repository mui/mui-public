import { createStarryNight } from '@wooorm/starry-night';
import type { ParseSource } from '../../CodeHighlighter/types';
import { grammars, extensionMap, getGrammarFromLanguage } from './grammars';
import { starryNightGutter } from './addLineGutters';

type StarryNight = Awaited<ReturnType<typeof createStarryNight>>;

const STARRY_NIGHT_KEY = '__docs_infra_starry_night_instance__';

export const parseSource: ParseSource = (source, fileName, language) => {
  const starryNight = (globalThis as any)[STARRY_NIGHT_KEY] as StarryNight | undefined;
  if (!starryNight) {
    throw new Error(
      'Starry Night not initialized. Use createParseSource to create an initialized parseSource function.',
    );
  }

  // Determine the grammar scope: prefer explicit language, then fall back to file extension
  let grammarScope: string | undefined;

  if (language) {
    grammarScope = getGrammarFromLanguage(language);
  }

  if (!grammarScope && fileName) {
    const fileType = fileName.slice(fileName.lastIndexOf('.'));
    grammarScope = extensionMap[fileType];
  }

  if (!grammarScope) {
    // Return a basic HAST root node with the source text for unsupported file types
    // TODO: should we split and add line gutters?
    return {
      type: 'root',
      children: [
        {
          type: 'text',
          value: source,
        },
      ],
    };
  }

  const highlighted = starryNight.highlight(source, grammarScope);
  const sourceLines = source.split(/\r?\n|\r/);
  starryNightGutter(highlighted, sourceLines); // mutates the tree to add line gutters

  return highlighted;
};

export const createParseSource = async (): Promise<ParseSource> => {
  if (!(globalThis as any)[STARRY_NIGHT_KEY]) {
    (globalThis as any)[STARRY_NIGHT_KEY] = await createStarryNight(grammars);
  }

  return parseSource;
};
