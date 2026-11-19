import { createStarryNight } from '@wooorm/starry-night';
import sourceTsx from '@wooorm/starry-night/source.tsx';

export const highlight = async (source: string) =>
  (await createStarryNight([sourceTsx])).highlight(source, 'source.tsx');
