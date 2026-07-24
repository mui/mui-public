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
 * Exports matching no known authoring style are returned unchanged.
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

  for (const node of exports) {
    if (isLiteralType(node.type)) {
      const value = readLiteralValue(node.type.value);
      if (value !== undefined) {
        members.push(new EnumMember(node.name, value, node.documentation));
      }
    }
  }

  if (members.length === 0) {
    return exports;
  }

  return [
    new ExportNode(groupName, new EnumNode(new TypeName(groupName), members, undefined), undefined),
  ];
}
