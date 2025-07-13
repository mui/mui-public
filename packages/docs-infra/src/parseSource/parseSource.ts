import { createStarryNight } from '@wooorm/starry-night';
import { ParseSource } from '../CodeHighlighter';
import { grammars, extensionMap } from './grammars';

const starryNight: { highlight?: ReturnType<typeof createStarryNight> } = {};

export const parseSource: ParseSource = async (source, fileName) => {
  if (!starryNight.highlight) {
    starryNight.highlight = createStarryNight(grammars);
  }

  const fileType = fileName.slice(fileName.lastIndexOf('.')) || 'plaintext';

  const sn = await starryNight.highlight;
  return sn.highlight(source, extensionMap[fileType] || 'plaintext');
};
