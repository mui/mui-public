import type * as tae from 'typescript-api-extractor';
import { findComponentConstantGroups, isPublicComponent } from './formatComponent';
import { isConstantGroupReExport } from './foldConstantGroupReExports';
import type { ReExportInfo } from './formatRaw';

/**
 * Links each constant group published under its own name to the component whose data
 * attributes or CSS variables it holds, so it can be documented as a re-export of that
 * component's table rather than repeating it.
 *
 * Groups are matched through the metadata file behind them rather than by name, which
 * covers groups published under another component's name or another suffix.
 *
 * @param exports - The entrypoint's exports, after `foldConstantGroupReExports`
 * @param allExports - Everything components look up their constant groups in
 * @returns Re-export info keyed by the group's public name
 */
export function linkConstantGroupReExports(
  exports: tae.ExportNode[],
  allExports: tae.ExportNode[],
): Map<string, ReExportInfo> {
  const links = new Map<string, ReExportInfo>();
  if (!exports.some(isConstantGroupReExport)) {
    return links;
  }

  const usedBy = new Map<string, { component: string; suffix: ReExportInfo['suffix'] }[]>();
  const addUse = (group: tae.ExportNode, component: string, suffix: ReExportInfo['suffix']) => {
    const source = isConstantGroupReExport(group) ? group.constantGroupSource : group.name;
    usedBy.set(source, [...(usedBy.get(source) ?? []), { component, suffix }]);
  };

  for (const node of exports) {
    if (isPublicComponent(node)) {
      const { dataAttributes, cssVariables } = findComponentConstantGroups(node, allExports);
      if (dataAttributes) {
        addUse(dataAttributes, node.name, 'data-attributes');
      }
      if (cssVariables) {
        addUse(cssVariables, node.name, 'css-variables');
      }
    }
  }

  for (const node of exports) {
    const uses = isConstantGroupReExport(node) ? usedBy.get(node.constantGroupSource) : undefined;
    if (uses) {
      // When several parts share a metadata file, prefer the one the group is named after.
      const use =
        uses.find(({ component }) => node.name.startsWith(component.replace(/\./g, ''))) ?? uses[0];
      const name = use.component.split('.').pop()!;
      links.set(node.name, { name, slug: `#${name.toLowerCase()}`, suffix: use.suffix });
    }
  }

  return links;
}
