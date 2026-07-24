#!/usr/bin/env node

/* eslint-disable no-console */

import chalk from 'chalk';

import { getWorkspacePackages } from '../utils/pnpm.mjs';
import { renameWorkspaceScope } from '../utils/scope.mjs';

/**
 * A scope is a single `@`-prefixed segment. Letting a `/` through would build
 * names like `@acme/private/pkg`, which only npm rejects, long after every
 * matching manifest has been rewritten.
 */
const SCOPE_PATTERN = /^@[a-z0-9-~][a-z0-9-._~]*$/;

/**
 * @typedef {Object} Args
 * @property {[string, string]} alias Source and target scope
 */

/**
 * @param {string} alias
 * @returns {[string, string]}
 */
export function parseAlias(alias) {
  const parts = alias.split(':');
  const [from, to] = parts;
  if (parts.length !== 2 || !SCOPE_PATTERN.test(from) || !SCOPE_PATTERN.test(to)) {
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
        coerce: parseAlias,
      })
      .example(
        '$0 rename-scope @acme:@acme-private',
        'Publish the workspace @acme packages under @acme-private',
      ),
  handler: async (argv) => {
    const [from, to] = argv.alias;
    const packages = await getWorkspacePackages();
    const renamed = await renameWorkspaceScope(packages, from, to);

    // Matching nothing means the mapping is wrong or stale. Carrying on would
    // publish under the original scope, so fail instead of reporting success.
    if (renamed.size === 0) {
      throw new Error(
        `No publishable workspace packages found in ${from}. Check the scope mapping "${from}:${to}", or the workspace may already have been renamed.`,
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
