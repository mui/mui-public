#!/usr/bin/env node

/* eslint-disable no-console */

import chalk from 'chalk';

import { getWorkspacePackages } from '../utils/pnpm.mjs';
import { renameWorkspaceScope } from '../utils/scope.mjs';

/**
 * @typedef {Object} Args
 * @property {string} alias Scope mapping written as `@from:@to`
 */

/**
 * @param {string} alias
 * @returns {[string, string]}
 */
export function parseAlias(alias) {
  const parts = alias.split(':');
  const [from, to] = parts;
  if (parts.length !== 2 || !from.startsWith('@') || !to.startsWith('@')) {
    throw new Error(
      `Invalid scope mapping "${alias}". Expected exactly two npm scopes separated by a colon, e.g. "@acme:@acme-private".`,
    );
  }
  return [from, to];
}

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'rename-scope <alias>',
  describe: 'Move publishable workspace packages to a different npm scope',
  builder: (yargs) =>
    yargs
      .positional('alias', {
        type: 'string',
        describe: 'Scope mapping written as "@from:@to"',
      })
      .example(
        '$0 rename-scope @acme:@acme-private',
        'Publish the workspace @acme packages under @acme-private',
      ),
  handler: async (argv) => {
    const [from, to] = parseAlias(argv.alias);
    const packages = await getWorkspacePackages();
    const renamed = await renameWorkspaceScope(packages, from, to);

    // Matching nothing means the mapping is wrong or stale. Carrying on would
    // publish under the original scope, so fail instead of reporting success.
    if (renamed.size === 0) {
      throw new Error(
        `No publishable workspace packages found in ${from}. Check the scope mapping "${argv.alias}".`,
      );
    }

    for (const [oldName, newName] of renamed) {
      console.log(`📦 ${oldName} → ${chalk.bold(newName)}`);
    }

    console.log(
      chalk.yellow(
        '\n⚠️  Workspace manifests were rewritten in place and are not restored. Discard them before committing.',
      ),
    );
  },
});
