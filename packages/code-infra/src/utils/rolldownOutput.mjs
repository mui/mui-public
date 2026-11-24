import { RolldownMagicString } from 'rolldown';

export const DTS_FILES = /\.d\.[cm]?ts$/;

export const GENERATED_NAMESPACE = /_exports$/;

/**
 * @typedef {{ start: number; end: number; text: string }} Edit
 * @typedef {import('rolldown/utils').ESTree.Node} Node
 * @typedef {import('rolldown/utils').ESTree.ModuleExportName | import('rolldown/utils').ESTree.BindingIdentifier} Name
 */

/**
 * @param {string} code
 * @param {Edit[]} edits
 */
export function applyEdits(code, edits) {
  const result = new RolldownMagicString(code);

  for (const { start, end, text } of edits) {
    if (text) {
      result.update(start, end, text);
    } else {
      result.remove(start, end);
    }
  }

  return result.toString();
}

/**
 * @param {string} code
 * @param {string} name
 */
export function countReferences(code, name) {
  const escaped = name.replace(/[$]/g, '\\$&');

  return code.match(new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'g'))?.length ?? 0;
}

/** @param {Name} node */
export function getName(node) {
  return node.type === 'Identifier' ? node.name : String(node.value);
}

/**
 * The imported and local names of an import specifier, or the local and exported names of an
 * export specifier.
 * @param {Node} specifier
 * @returns {[Name, Name] | []}
 */
export function getBinding(specifier) {
  if (specifier.type === 'ImportSpecifier') {
    return [specifier.imported, specifier.local];
  }

  if (specifier.type === 'ExportSpecifier') {
    return [specifier.local, specifier.exported];
  }

  return [];
}

/**
 * @param {string} code
 * @param {Node} node
 */
export function slice(code, node) {
  return code.slice(node.start, node.end);
}
