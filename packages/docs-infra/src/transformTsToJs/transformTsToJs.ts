import { removeTypes } from './removeTypes';
import type { TransformSource } from '../CodeHighlighter/index';

export const transformTsToJs: TransformSource = async (source, fileName) => {
  const transformed = await removeTypes(source);
  const transformedFileName = fileName.replace(/\.ts$/, '.js').replace(/\.tsx$/, '.jsx');

  return {
    js: { source: transformed, fileName: transformedFileName },
  };
};
