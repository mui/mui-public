/**
 * Utility function for creating StackBlitz demos
 * Returns the configuration that can be used with openWithForm
 */

import type { FlattenedFiles } from '../pipeline/loadCodeVariant/flattenCodeVariant';

/**
 * Create StackBlitz configuration for use with openWithForm
 */
export function createStackBlitz({
  title,
  description,
  flattenedFiles,
  rootFile,
}: {
  title: string;
  description: string;
  flattenedFiles: FlattenedFiles;
  rootFile: string;
}): {
  url: string;
  formData: Record<string, string>;
} {
  // Convert flattened files to string format
  const files: Record<string, string> = {};
  Object.entries(flattenedFiles).forEach(([filePath, fileData]) => {
    files[filePath] = fileData.source;
  });

  const formData: Record<string, string> = {
    'project[template]': 'node',
    'project[title]': title,
    'project[description]': `# ${title}\n${description}`,
  };

  Object.entries(files).forEach(([key, value]) => {
    formData[`project[files][${key}]`] = value;
  });

  return {
    url: `https://stackblitz.com/run?file=${rootFile}`,
    formData,
  };
}
