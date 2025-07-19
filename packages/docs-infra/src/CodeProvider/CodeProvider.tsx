'use client';

import * as React from 'react';
import { createStarryNight } from '@wooorm/starry-night';
import { CodeContext } from './CodeContext';
import { LoadCodeMeta, LoadSource, LoadVariantMeta, ParseSource } from '../CodeHighlighter';
import { extensionMap, grammars } from '../parseSource/grammars';

export function CodeProvider({
  children,
  loadCodeMeta,
  loadVariantMeta,
  loadSource,
}: {
  children: React.ReactNode;
  loadCodeMeta?: LoadCodeMeta;
  loadVariantMeta?: LoadVariantMeta;
  loadSource?: LoadSource;
}) {
  const [parseSource, setParseSource] = React.useState<ParseSource | undefined>(undefined);

  const sourceParser = React.useMemo(() => {
    // Only initialize Starry Night in the browser, not during SSR
    if (typeof window === 'undefined') {
      return Promise.resolve((() => {
        throw new Error('parseSource not available during SSR');
      }) as ParseSource);
    }

    return createStarryNight(grammars).then((starryNight) => {
      const parseSourceFn: ParseSource = (source: string, fileName: string) => {
        const fileType = fileName.slice(fileName.lastIndexOf('.')) || 'plaintext';
        return starryNight.highlight(source, extensionMap[fileType] || 'plaintext');
      };

      // Update the sync version when available
      setParseSource(parseSourceFn);

      return parseSourceFn;
    });
  }, []);

  const context = React.useMemo(
    () => ({
      sourceParser,
      parseSource, // Sync version when available
      loadSource,
      loadVariantMeta,
      loadCodeMeta,
    }),
    [sourceParser, parseSource, loadSource, loadVariantMeta, loadCodeMeta],
  );

  return <CodeContext.Provider value={context}>{children}</CodeContext.Provider>;
}
