/**
 * Utility function for creating CodeSandbox demos
 * Returns the configuration that can be used with openWithForm
 */

// @ts-ignore
import LZString from 'lz-string';

import type { FlattenedFiles } from './flattenVariant';

/**
 * Compress object for CodeSandbox API
 */
function compress(object: any): string {
  return LZString.compressToBase64(JSON.stringify(object))
    .replace(/\+/g, '-') // Convert '+' to '-'
    .replace(/\//g, '_') // Convert '/' to '_'
    .replace(/=+$/, ''); // Remove ending '='
}

/**
 * Create CodeSandbox for use with openWithForm
 */
export function createCodeSandbox({
  flattenedFiles,
  rootFile,
}: {
  flattenedFiles: FlattenedFiles;
  rootFile: string;
}): {
  url: string;
  formData: Record<string, string>;
} {
  // Convert flattened files to string format
  const files: Record<string, { content: string }> = {};
  Object.entries(flattenedFiles).forEach(([filePath, fileData]) => {
    files[filePath] = {
      content: fileData.source,
    };
  });

  const parameters = compress({ files });

  // ref: https://codesandbox.io/docs/learn/browser-sandboxes/cli-api#supported-parameters
  const formData: Record<string, string> = {
    parameters,
    query: `file=${rootFile}`,
  };

  return {
    url: 'https://codesandbox.io/api/v1/sandboxes/define',
    formData,
  };
}
