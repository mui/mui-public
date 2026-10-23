import * as path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

/** Everything a run writes lives here, so there is one thing to ignore and deleting it resets. */
export const OUTPUT_DIR = '.benchmark';

/**
 * Marks a generated directory ignored from the inside: a `.gitignore` holding `*` ignores its
 * contents and itself. Tools that read only the root ignore file still need an entry there.
 */
export async function markIgnored(dir: string): Promise<void> {
  await writeFile(path.join(dir, '.gitignore'), '*\n');
}

/** Creates the output directory, marked ignored. */
export async function prepareOutputDir(harnessDir: string): Promise<string> {
  const outputDir = path.join(harnessDir, OUTPUT_DIR);
  await mkdir(outputDir, { recursive: true });
  await markIgnored(outputDir);
  return outputDir;
}

/** Where a run writes its JSON report, unless told otherwise. */
export function resultsPathOf(harnessDir: string): string {
  return path.join(harnessDir, OUTPUT_DIR, 'results', 'report.json');
}

/** Where the pages of every ref are built, one directory per variant. */
export function buildsDirOf(harnessDir: string): string {
  return path.join(harnessDir, OUTPUT_DIR, 'builds');
}
