import { removeTypes } from './removeTypes';
import type { SourceTransformer, TransformSource } from '../../CodeHighlighter/types';

export const transformTypescriptToJavascript: TransformSource = async (source, fileName) => {
  // Prettier disabled to investigate an OOM in large Next.js production builds.
  // `retainLines: true` in `removeTypes` already preserves line numbers needed
  // by the diff pipeline, so output stays usable without formatting.
  const transformed = await removeTypes(source, fileName, false);
  const transformedFileName = fileName.replace(/\.ts$/, '.js').replace(/\.tsx$/, '.jsx');

  return {
    js: { source: transformed, fileName: transformedFileName },
  };
};

export const TypescriptToJavascriptTransformer: SourceTransformer = {
  extensions: ['ts', 'tsx'],
  transformer: transformTypescriptToJavascript,
};
