import { createStarryNight, common } from '@wooorm/starry-night';
import { ParseSource } from '../CodeHighlighter';
import { extensionMap } from './extensionMap';

const starryNight: { highlight?: ReturnType<typeof createStarryNight> } = {};

export const parseSource: ParseSource = async (source, fileName) => {
  if (!starryNight.highlight) {
    starryNight.highlight = createStarryNight(common);
  }

  const fileType = fileName.slice(fileName.lastIndexOf('.')) || 'plaintext';

  const sn = await starryNight.highlight;
  return sn.highlight(source, extensionMap[fileType] || 'plaintext');
};
