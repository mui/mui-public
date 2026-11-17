import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse, Visitor } from 'rolldown/utils';

/**
 * @param {string} file
 * @param {string} code
 * @returns {Promise<string[]>} The local specifiers the file passes to `require`.
 */
async function getRequires(file, code) {
  const { program } = await parse(file, code);
  /** @type {string[]} */
  const specifiers = [];
  new Visitor({
    CallExpression(node) {
      const [arg] = node.arguments;
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') {
        return;
      }
      if (arg?.type !== 'Literal' || typeof arg.value !== 'string' || !arg.value.startsWith('.')) {
        return;
      }
      specifiers.push(arg.value);
    },
  }).visit(program);
  return specifiers;
}

/**
 * Ships `.cjs` sources unchanged. Rolldown would turn them into ESM whose `require` calls go
 * through a runtime helper bundlers can't resolve, so imports of them stay as written and each is
 * emitted as is. The local modules one requires are built at the path the `require` names. Remove
 * this plugin with the last package that ships `.cjs` sources.
 * @param {string} sourceDir
 * @param {string[]} extensions The output extensions of the selected bundles.
 * @returns {import('tsdown').Rolldown.Plugin}
 */
export function cjsSourcesPlugin(sourceDir, extensions) {
  /**
   * @param {import('tsdown').Rolldown.PluginContext} context
   * @param {string} file
   * @param {Set<string>} seen The `.cjs` sources already emitted along this `require` chain.
   */
  async function emitSource(context, file, seen = new Set()) {
    if (seen.has(file)) {
      return;
    }
    seen.add(file);

    const code = await fs.readFile(file, 'utf8');
    context.emitFile({ type: 'asset', fileName: path.relative(sourceDir, file), source: code });

    for (const specifier of await getRequires(file, code)) {
      // eslint-disable-next-line no-await-in-loop
      const target = await context.resolve(specifier, file);
      if (!target || target.external || path.relative(sourceDir, target.id).startsWith('..')) {
        continue;
      }
      if (target.id.endsWith('.cjs')) {
        // eslint-disable-next-line no-await-in-loop
        await emitSource(context, target.id, seen);
        continue;
      }
      if (!extensions.includes(path.extname(target.id))) {
        context.error(
          `${path.relative(sourceDir, file)} requires '${specifier}', which no bundle outputs at that path.`,
        );
      }
      context.emitFile({ type: 'chunk', id: target.id, preserveSignature: 'strict' });
    }
  }

  return {
    name: 'code-infra:cjs-sources',
    resolveId: {
      filter: { id: /\.cjs$/ },
      async handler(source, importer) {
        // Entries can't be external.
        if (!importer) {
          return null;
        }
        const resolved = await this.resolve(source, importer, { skipSelf: true });
        if (!resolved || resolved.external) {
          return null;
        }
        await emitSource(this, resolved.id);
        return { id: source, external: true };
      },
    },
  };
}
