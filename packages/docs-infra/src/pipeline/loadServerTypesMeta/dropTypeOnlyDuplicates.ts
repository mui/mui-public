import type * as tae from '@mui/internal-typescript-api-extractor';
import { isComponentType } from './typeGuards';

/**
 * Drops type-only exports that repeat a namespaced component re-export under its original name,
 * such as `DialogTrigger` and `DialogTrigger.Props` (reached through `export type *`) next to
 * `Dialog.Trigger` and `Dialog.Trigger.Props`. They would be documented twice, and the members
 * would win the flat-name mapping over the namespaced names.
 *
 * Plain flat types (`ProgressStatus` next to `Progress.Status`) are kept, since the pipeline turns
 * them into aliases of their namespaced names, and so are value exports, which are real API.
 */
export function dropTypeOnlyDuplicates(exports: tae.ExportNode[]): tae.ExportNode[] {
  const names = new Set(exports.map((node) => node.name));
  const reexportNames = new Map<string, string>();
  for (const node of exports) {
    if (node.reexportedFrom && node.name.includes('.')) {
      reexportNames.set(node.reexportedFrom, node.name);
    }
  }

  return exports.filter((node) => {
    if (node.isValue) {
      return true;
    }

    const [head, ...rest] = node.name.split('.');
    const reexportName = reexportNames.get(head);
    const isDuplicate = reexportName !== undefined && names.has([reexportName, ...rest].join('.'));
    return !isDuplicate || (rest.length === 0 && !isComponentType(node.type));
  });
}
