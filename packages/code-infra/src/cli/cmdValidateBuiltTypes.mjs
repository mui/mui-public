/* eslint-disable no-console */
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';

import { mapConcurrently } from '../utils/build.mjs';

const DYNAMIC_PACKAGES_IMPORT_REGEX = /import\((['"])packages\//gm;

/**
 * Validates if there are no missing exports from TS files that would
 * result in an import from a local file.
 */
async function validateFiles() {
  const cwd = process.cwd();
  const workspaceRoot = await findWorkspaceDir(cwd);
  const declarationFiles = await globby(['**/build/**/*.d.{ts,cts,mts}'], {
    absolute: true,
    ignore: ['node_modules'],
    followSymbolicLinks: false,
    cwd: workspaceRoot,
  });

  const invalidFiles = (
    await mapConcurrently(
      declarationFiles,
      async (declarationFile) => {
        const content = await fs.readFile(declarationFile, 'utf-8');
        const matches = Array.from(content.matchAll(DYNAMIC_PACKAGES_IMPORT_REGEX));
        return matches.length > 0 ? declarationFile : undefined;
      },
      20,
    )
  ).filter((file) => typeof file === 'string');

  if (invalidFiles.length > 0) {
    console.error('❌ Found invalid imports in the following files:');
    console.log(invalidFiles.join('\n'));
    process.exit(1);
  }

  console.log('✅ Found no invalid import statements in built declaration files.');
}

export default /** @type {import('yargs').CommandModule<{}, {}>} */ ({
  command: 'validate-built-types',
  describe: 'Validate built TypeScript declaration files for invalid imports from local files.',
  handler: validateFiles,
});
