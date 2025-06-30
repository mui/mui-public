'use client';

import * as React from 'react';
import { common, createStarryNight } from '@wooorm/starry-night';
import { HighlightContext } from './HighlightContext';

import type { Nodes as HastNode } from 'hast';

export function HighlightProvider({ children }: { children: React.ReactNode }) {
  const [highlight, setHighlight] = React.useState<
    ((code: string, language: string) => Promise<HastNode>) | null
  >(null);

  React.useEffect(() => {
    (async () => {
      const starryNight = await createStarryNight(common);
      setHighlight(async (code, language) => starryNight.highlight(code, language));
    })();
  }, []);

  return <HighlightContext.Provider value={highlight}>{children}</HighlightContext.Provider>;
}
