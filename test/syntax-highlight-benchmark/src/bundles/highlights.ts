import { codeToTokens } from '@pierre/highlights';
import type { Lang } from '@pierre/highlights';

export const highlight = (source: string, lang: Lang) =>
  codeToTokens(source, {
    lang,
    theme: { name: 'token-types', appearance: 'light', style: {}, cssVariables: true },
  });
