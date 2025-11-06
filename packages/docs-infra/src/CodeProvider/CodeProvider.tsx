'use client';

import * as React from 'react';
import { createStarryNight } from '@wooorm/starry-night';
import { CodeContext } from './CodeContext';
import type {
  LoadCodeMeta,
  LoadSource,
  LoadVariantMeta,
  ParseSource,
} from '../CodeHighlighter/types';
import { extensionMap, grammars } from '../pipeline/parseSource/grammars';
import { starryNightGutter } from '../pipeline/parseSource/addLineGutters';
// Import the heavy functions
import { loadCodeFallback } from '../pipeline/loadCodeVariant/loadCodeFallback';
import { loadCodeVariant } from '../pipeline/loadCodeVariant/loadCodeVariant';
import { parseCode } from '../pipeline/loadCodeVariant/parseCode';
import { parseControlledCode } from '../CodeHighlighter/parseControlledCode';
import {
  computeHastDeltas,
  getAvailableTransforms,
} from '../pipeline/loadCodeVariant/computeHastDeltas';

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
        const sourceLines = source.split(/\r?\n|\r/);
        starryNightGutter(highlighted, sourceLines); // mutates the tree to add line gutters

        return highlighted;
      };

      return parseSourceFn;
    });
  }, []);

  React.useEffect(() => {
    // Update the sync version when available
    sourceParser.then((parseSourceFn) => setParseSource(() => parseSourceFn));
  }, [sourceParser]);

  const context = React.useMemo(
    () => ({
      sourceParser,
      parseSource, // Sync version when available
      loadSource,
      loadVariantMeta,
      loadCodeMeta,
      // Provide the heavy functions
      loadCodeFallback,
      loadCodeVariant,
      parseCode,
      parseControlledCode,
      computeHastDeltas,
      getAvailableTransforms,
    }),
    [sourceParser, parseSource, loadSource, loadVariantMeta, loadCodeMeta],
  );

  return <CodeContext.Provider value={context}>{children}</CodeContext.Provider>;
}
