import { createStarryNight } from '@wooorm/starry-night';
import { STARRY_NIGHT_GRAMMARS } from '../engines/starryNight';

export const highlight = async (source: string, scope: string) =>
  (await createStarryNight(STARRY_NIGHT_GRAMMARS)).highlight(source, scope);
