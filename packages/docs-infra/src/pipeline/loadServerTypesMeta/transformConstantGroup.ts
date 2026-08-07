import { EnumMember, EnumNode, ExportNode, TypeName } from 'typescript-api-extractor';
import type * as tae from 'typescript-api-extractor';
import { fileUrlToPortablePath } from '../loaderUtils/fileUrlToPortablePath';
import { getFileNameFromUrl } from '../loaderUtils/getFileNameFromUrl';
import { isEnumType, isLiteralType } from './typeGuards';

/**
 * Derives a constant group's name from its file path, e.g.
 * `/src/accordion/panel/AccordionPanelCssVars.ts` becomes `AccordionPanelCssVars`.
 */
function getGroupName(filePath: string): string {
  const { fileName, extension } = getFileNameFromUrl(fileUrlToPortablePath(filePath));
  return extension ? fileName.slice(0, -extension.length) : fileName;
}

/**
 * Reads a constant's value from its literal type.
 *
 * String literals arrive wrapped in quotes (`"data-open"`) while numeric literals do not,
 * so both are normalized to the bare string an enum member would have carried. Anything
 * else — objects, functions, booleans — is not a documentable constant.
 */
function readLiteralValue(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return String(value);
  }

  if (
    typeof value === 'string' &&
    value.length >= 2 &&
    value.startsWith('"') &&
    value.endsWith('"')
  ) {
    return value.slice(1, -1);
  }

  return undefined;
}

/**
 * Normalizes a metadata file's exports into a single constant group named after the file.
 *
 * A constant group is a named, documented set of key/value constants belonging to one
 * component — the data attributes it sets, or the CSS variables it reads. Authors may
 * declare it as an enum named after the file, or as named literal constants; both end up
 * as the same enum-shaped export so the rest of the pipeline sees one representation.
 *
 * Exports matching no known authoring style are returned unchanged. Once a group is formed
 * it replaces the file's exports, and any export that is not a constant is dropped with a
 * warning naming it.
 */
export function transformConstantGroup(
  filePath: string,
  exports: tae.ExportNode[],
): tae.ExportNode[] {
  const groupName = getGroupName(filePath);

  // Already an enum declaration named after its file, so there is nothing to normalize.
  if (exports.some((node) => node.name === groupName && isEnumType(node.type))) {
    return exports;
  }

  // Literal constants are folded into members of a single group rather than left alongside
  // it: names this generic (`open`, `index`, `disabled`) would shadow real types when
  // resolving `{@link}` references.
  const members: EnumMember[] = [];
  const discarded: string[] = [];

  for (const node of exports) {
    const value = isLiteralType(node.type) ? readLiteralValue(node.type.value) : undefined;
    if (value === undefined) {
      discarded.push(node.name);
    } else {
      members.push(new EnumMember(node.name, value, node.documentation));
    }
  }

  if (members.length === 0) {
    return exports;
  }

  // The group replaces the file's exports wholesale, so anything that is not a constant —
  // a helper function, a type alias, an enum under another name — is documented nowhere.
  // Metadata files are expected to hold constants only; say so rather than fail silently.
  if (discarded.length > 0) {
    console.warn(
      `[transformConstantGroup] ${groupName} - dropping exports that are not constants: ${discarded.join(', ')}`,
    );
  }

  return [
    new ExportNode(groupName, new EnumNode(new TypeName(groupName), members, undefined), undefined),
  ];
}
