#!/usr/bin/env node

/* eslint-disable no-console */

import chalk from 'chalk';

import { getWorkspacePackages } from '../utils/pnpm.mjs';
import { renameWorkspaceScope } from '../utils/scope.mjs';

/**
 * @typedef {Object} Args
 * @property {string[]} alias Scope mappings, each written as `@from:@to`
 */

/**
 * @param {string} alias
 * @returns {[string, string]}
 */
function parseAlias(alias) {
  const separator = alias.indexOf(':');
  const from = separator === -1 ? '' : alias.slice(0, separator);
  const to = separator === -1 ? '' : alias.slice(separator + 1);
  if (!from.startsWith('@') || !to.startsWith('@')) {
    throw new Error(
      `Invalid scope mapping "${alias}". Expected two npm scopes separated by a colon, e.g. "@acme:@acme-private".`,
    );
  }
  return [from, to];
}

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'rename-scope <alias..>',
  describe: 'Move publishable workspace packages to a different npm scope',
  builder: (yargs) =>
    yargs
      .positional('alias', {
        type: 'string',
        array: true,
        describe: 'Scope mapping written as "@from:@to"',
      })
      .example(
        '$0 rename-scope @acme:@acme-private',
        'Publish the workspace @acme packages under @acme-private',
      ),
  handler: async (argv) => {
    for (const alias of argv.alias) {
      const [from, to] = parseAlias(alias);
      // Re-read between mappings: a previous one may have renamed packages.
      // eslint-disable-next-line no-await-in-loop
      const packages = await getWorkspacePackages();
      // eslint-disable-next-line no-await-in-loop
      const { renamed } = await renameWorkspaceScope(packages, from, to);

      if (renamed.size === 0) {
        console.log(`ℹ️  No publishable workspace packages found in ${chalk.bold(from)}`);
        continue;
      }

      for (const [oldName, newName] of renamed) {
        console.log(`📦 ${oldName} → ${chalk.bold(newName)}`);
      }
    }
  },
});
