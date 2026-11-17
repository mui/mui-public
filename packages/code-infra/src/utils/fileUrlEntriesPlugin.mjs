import * as path from 'node:path';
import { RolldownMagicString } from 'rolldown';
import { parse, Visitor } from 'rolldown/utils';

const SCRIPT_FILES = /\.[cm]?[jt]sx?$/;
const TS_FILES = /\.[cm]?ts$/;

/**
 * @typedef {import('rolldown/utils').ESTree.NewExpression} NewExpression
 */

/**
 * Returns the relative path of `new URL('./file', import.meta.url)`.
 * @param {NewExpression} node
 */
function getFileUrlPath(node) {
  const [file, base] = node.arguments;
  if (
    node.callee.type !== 'Identifier' ||
    node.callee.name !== 'URL' ||
    file?.type !== 'Literal' ||
    typeof file.value !== 'string' ||
    !file.value.startsWith('.') ||
    base?.type !== 'MemberExpression' ||
    base.object.type !== 'MetaProperty' ||
    base.property.type !== 'Identifier' ||
    base.property.name !== 'url'
  ) {
    return undefined;
  }
  return file.value;
}

/**
 * Builds the modules sources load with `new URL('./file', import.meta.url)`, such as workers,
 * which no import reaches, and points the URL at their output.
 * @returns {import('tsdown').Rolldown.Plugin}
 */
export function fileUrlEntriesPlugin() {
  return {
    name: 'code-infra:file-url-entries',
    transform: {
      filter: { id: { exclude: /node_modules/ }, code: 'import.meta.url' },
      async handler(code, id) {
        // `.js` sources may contain JSX.
        const lang = TS_FILES.test(id) ? 'ts' : 'tsx';
        const { program } = await parse(id, code, { lang });

        /** @type {NewExpression[]} */
        const urls = [];
        new Visitor({
          NewExpression(node) {
            if (getFileUrlPath(node)) {
              urls.push(node);
            }
          },
        }).visit(program);

        const result = new RolldownMagicString(code);
        const resolved = await Promise.all(
          urls.map((node) => this.resolve(/** @type {string} */ (getFileUrlPath(node)), id)),
        );
        resolved.forEach((target, index) => {
          if (!target || target.external || !SCRIPT_FILES.test(target.id)) {
            return;
          }
          const ref = this.emitFile({ type: 'chunk', id: target.id, preserveSignature: 'strict' });
          result.update(urls[index].start, urls[index].end, `import.meta.ROLLUP_FILE_URL_${ref}`);
        });
        return result.hasChanged() ? result.toString() : null;
      },
    },
    resolveFileUrl({ chunkId, fileName, format }) {
      const relative = path.posix.relative(path.posix.dirname(chunkId), fileName);
      const file = JSON.stringify(relative.startsWith('.') ? relative : `./${relative}`);
      // Bundlers only treat the literal `new URL('./file', import.meta.url)` as a worker or asset.
      return format === 'es'
        ? `new URL(${file}, import.meta.url)`
        : `new URL(${file}, require("node:url").pathToFileURL(__filename))`;
    },
  };
}
