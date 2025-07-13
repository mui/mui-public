'use client';

import * as React from 'react';
import { common, createStarryNight } from '@wooorm/starry-night';
import { CodeContext } from './CodeContext';
import { ParseSource } from '../CodeHighlighter';

const extensionToLanguage: Record<string, string | undefined> = {
  // TODO: I'm not sure this is correct
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.css': 'css',
};

export function CodeProvider({ children }: { children: React.ReactNode }) {
  const [parseSource, setParseSource] = React.useState<ParseSource | undefined>(undefined);

  const context = React.useMemo(() => ({ parseSource }), [parseSource]);

  // TODO: fix race condition where parseSource is not set before the first render
  React.useEffect(() => {
    (async () => {
      const starryNight = await createStarryNight(common);
      const highlight: ParseSource = async (code, fileName) =>
        starryNight.highlight(
          code,
          extensionToLanguage[fileName.slice(fileName.lastIndexOf('.'))] || 'plaintext',
        );
      setParseSource(highlight);
    })();
  }, []);

  return <CodeContext.Provider value={context}>{children}</CodeContext.Provider>;
}
