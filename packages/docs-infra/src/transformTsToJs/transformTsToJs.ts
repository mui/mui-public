import { removeTypes } from 'babel-remove-types';
import type { TransformSource } from '../CodeHighlighter/index';

const transformTsToJs: TransformSource = async (source, fileName) => {
  if (!fileName.endsWith('.ts') && !fileName.endsWith('.tsx')) {
    return undefined;
  }

  const transformed = await removeTypes(source);
  const transformedFileName = fileName.replace(/\.ts$/, '.js').replace(/\.tsx$/, '.jsx');

  return {
    js: { source: transformed, fileName: transformedFileName },
  };
};

export default transformTsToJs;
