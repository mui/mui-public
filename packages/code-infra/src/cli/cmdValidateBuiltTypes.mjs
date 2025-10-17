/* eslint-disable no-console */
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';

import { mapConcurrently } from '../utils/build.mjs';

/**
 * Validates if there are no missing exports from TS files that would
 * result in an import from a local file.
 */
async function validateFiles() {
  const cwd = process.cwd();
  const workspaceRoot = await findWorkspaceDir(cwd);
  const declarationFiles = await globby(['packages/*/build/**/*.d.{ts,cts,mts}'], {
    absolute: true,
    ignore: ['node_modules'],
    followSymbolicLinks: false,
    cwd: workspaceRoot,
  });
  /**
   * @type {string[]}
   */
  const invalidFiles = [];
  /**
   * @type {string[]}
   */
  const invalidFilesWithMuiImportErrors = [];

  await mapConcurrently(
    declarationFiles,
    async (declarationFile) => {
      const content = await fs.readFile(declarationFile, 'utf-8');
      const regex = /import\(["']packages\//gm;
      if (regex.test(content)) {
        invalidFiles.push(declarationFile);
      }
      const typeImportsFromMuiPackages = declarationFile.match(/import\(("|')packages\/mui/g);

      if (typeImportsFromMuiPackages !== null) {
        invalidFilesWithMuiImportErrors.push(
          // readable path for CI while making it clickable locally
          `${path.relative(cwd, declarationFile)} imports types ${
            typeImportsFromMuiPackages.length
          } times from other packages that are unreachable once published.`,
        );
      }
    },
    20,
  );

  if (invalidFiles.length) {
    console.error('❌ Found invalid imports in the following files:');
    invalidFiles.forEach((file) => console.error(file));
  }

  if (invalidFilesWithMuiImportErrors.length) {
    console.error(
      '❌ Found invalid MUI imports in the following files (see individual errors below):',
    );
    invalidFilesWithMuiImportErrors.forEach((error) => console.error(error));
  }

  if (invalidFiles.length > 0 || invalidFilesWithMuiImportErrors.length > 0) {
    process.exit(1);
  }

  console.log('✅ Found no invalid import statements in built declaration files.');
}

export default /** @type {import('yargs').CommandModule<{}, {}>} */ ({
  command: 'validate-built-types',
  describe: 'Validate built TypeScript declaration files for invalid imports from local files.',
  handler: validateFiles,
});
