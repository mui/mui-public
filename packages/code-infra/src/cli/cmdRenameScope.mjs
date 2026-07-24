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
  const [from, to] = alias.split(':');
  if (!from?.startsWith('@') || !to?.startsWith('@')) {
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
    // Validate every mapping before touching disk, so a typo in the second one
    // can't leave the workspace half renamed.
    const aliases = argv.alias.map(parseAlias);
    const packages = await getWorkspacePackages();
    let renamedAny = false;

    for (const [from, to] of aliases) {
      // Sequential: each mapping rewrites manifests the next one may match.
      // eslint-disable-next-line no-await-in-loop
      const renamed = await renameWorkspaceScope(packages, from, to);

      if (renamed.size === 0) {
        console.log(`ℹ️  No publishable workspace packages found in ${chalk.bold(from)}`);
        continue;
      }
      renamedAny = true;

      for (const [oldName, newName] of renamed) {
        console.log(`📦 ${oldName} → ${chalk.bold(newName)}`);
      }
      // Keep the in-memory names in step so a later mapping sees this one.
      for (const pkg of packages) {
        const newName = pkg.name && renamed.get(pkg.name);
        if (newName) {
          pkg.name = newName;
        }
      }
    }

    if (renamedAny) {
      console.log(
        chalk.yellow(
          '\n⚠️  Workspace manifests were rewritten in place and are not restored. Discard them before committing.',
        ),
      );
    }
  },
});
