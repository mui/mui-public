import { fileConventions } from './fileConventions';

export async function getFileConventions() {
  return fileConventions; // TODO: Parse the next.config.js file to get convention overrides.
}
