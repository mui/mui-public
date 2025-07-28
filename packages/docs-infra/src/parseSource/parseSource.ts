import { createStarryNight } from '@wooorm/starry-night';
import { ParseSource } from '../CodeHighlighter';
import { grammars, extensionMap } from './grammars';

type StarryNight = Awaited<ReturnType<typeof createStarryNight>>;

let starryNight: StarryNight | null = null;

export const parseSource: ParseSource = (source, fileName) => {
  if (!starryNight) {
    throw new Error(
      'Starry Night not initialized. Use parseSourceFactory to create an initialized parseSource function.',
    );
  }

  const fileType = fileName.slice(fileName.lastIndexOf('.'));
  if (!extensionMap[fileType]) {
    throw new Error(`Unsupported file type: ${fileType}`);
  }

  return starryNight.highlight(source, extensionMap[fileType]);
};

export const parseSourceFactory = async (): Promise<ParseSource> => {
  if (!starryNight) {
    starryNight = await createStarryNight(grammars);
  }

  return parseSource;
};
