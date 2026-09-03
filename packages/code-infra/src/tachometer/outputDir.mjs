import * as path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

/**
 * Everything a run writes — packed tarballs, isolated installs, built pages, the report — lives
 * under this one directory inside the harness, so a repository has a single thing to ignore and
 * deleting it is the whole reset story.
 */
export const OUTPUT_DIR = '.tachometer';

/**
 * Creates the output directory, marking it ignored from the inside.
 *
 * A `.gitignore` holding `*` ignores the directory's contents and itself, the way pytest marks its
 * cache, so a harness that forgets to list it does not end up offering built pages and tarballs for
 * commit. It does not replace an entry in the repository's own ignore file: tools that read only
 * the root one — this repository's ESLint config among them — never see a nested `.gitignore`.
 *
 * @param {string} harnessDir - The harness package directory
 * @returns {Promise<string>} The output directory
 */
export async function prepareOutputDir(harnessDir) {
  const outputDir = path.join(harnessDir, OUTPUT_DIR);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, '.gitignore'), '*\n');
  return outputDir;
}
