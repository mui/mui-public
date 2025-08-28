import { createStarryNight } from '@wooorm/starry-night';
import { ParseSource } from '../../CodeHighlighter';
import { grammars, extensionMap } from './grammars';
import { starryNightGutter } from './addLineGutters';

type StarryNight = Awaited<ReturnType<typeof createStarryNight>>;

const STARRY_NIGHT_KEY = '__docs_infra_starry_night_instance__';

export const parseSource: ParseSource = (source, fileName) => {
  const starryNight = (globalThis as any)[STARRY_NIGHT_KEY] as StarryNight | undefined;
  if (!starryNight) {
    throw new Error(
      'Starry Night not initialized. Use createParseSource to create an initialized parseSource function.',
    );
  }

  const fileType = fileName.slice(fileName.lastIndexOf('.'));
  if (!extensionMap[fileType]) {
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

  const highlighted = starryNight.highlight(source, extensionMap[fileType]);
  starryNightGutter(highlighted); // mutates the tree to add line gutters

  return highlighted;
};

export const createParseSource = async (): Promise<ParseSource> => {
  if (!(globalThis as any)[STARRY_NIGHT_KEY]) {
    (globalThis as any)[STARRY_NIGHT_KEY] = await createStarryNight(grammars);
  }

  return parseSource;
};
