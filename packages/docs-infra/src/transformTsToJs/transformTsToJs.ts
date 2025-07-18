import { removeTypes } from './removeTypes';
import type { SourceTransformer, TransformSource } from '../CodeHighlighter';

export const transformTsToJs: TransformSource = async (source, fileName) => {
  const transformed = await removeTypes(source, fileName);
  const transformedFileName = fileName.replace(/\.ts$/, '.js').replace(/\.tsx$/, '.jsx');

  return {
    js: { source: transformed, fileName: transformedFileName },
  };
};

export const TsToJsTransformer: SourceTransformer = {
  extensions: ['ts', 'tsx'],
  transformer: transformTsToJs,
};
