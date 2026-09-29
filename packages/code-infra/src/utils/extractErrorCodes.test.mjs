import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { extractErrorCodesForFiles } from './extractErrorCodes.mjs';
import { makeTempDir } from './testUtils.mjs';

/**
 * @param {Record<string, string>} files
 */
async function writeFiles(files) {
  const dir = await makeTempDir();
  const paths = await Promise.all(
    Object.entries(files).map(async ([name, contents]) => {
      const filePath = path.join(dir, name);
      await fs.writeFile(filePath, contents, 'utf8');
      return filePath;
    }),
  );
  return paths;
}

describe('extractErrorCodesForFiles', () => {
  it('collects messages from .ts, .tsx and .js files', async () => {
    const files = await writeFiles({
      'Button.tsx': `export const Button = () => { throw new Error('MUI: tsx'); return <div />; };`,
      'helper.js': `export const helper = () => { throw new Error('MUI: js'); return <div />; };`,
      'traverse.ts': `export const traverse = <T = unknown>(value: T) => { throw new Error('MUI: ts'); };`,
    });
    const errors = new Set();

    await extractErrorCodesForFiles(files, errors, 'opt-out');

    expect(Array.from(errors).sort()).toEqual(['MUI: js', 'MUI: ts', 'MUI: tsx']);
  });
});
