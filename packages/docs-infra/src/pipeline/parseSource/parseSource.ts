import { createStarryNight } from '@wooorm/starry-night';
import { ParseSource } from '../../CodeHighlighter';
import { grammars, extensionMap } from './grammars';
import { starryNightGutter } from './addLineGutters';

type StarryNight = Awaited<ReturnType<typeof createStarryNight>>;

let starryNight: StarryNight | null = null;

export const parseSource: ParseSource = (source, fileName) => {
  if (!starryNight) {
    throw new Error(
      'Starry Night not initialized. Use createParseSource to create an initialized parseSource function.',
    );
  }

  const fileType = fileName.slice(fileName.lastIndexOf('.'));
  if (!extensionMap[fileType]) {
    // Return a basic HAST root node with the source text for unsupported file types
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
  if (!starryNight) {
    starryNight = await createStarryNight(grammars);
  }

  return parseSource;
};
