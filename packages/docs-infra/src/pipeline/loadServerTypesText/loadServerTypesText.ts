import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { TypesMeta } from '../loadServerTypesMeta';
import { type OrganizeTypesResult } from './organizeTypesByExport';
import { parseTypesMarkdown } from './parseTypesMarkdown';
import type { OrderingConfig } from './order';

/**
 * Common data returned by both syncTypes and loadServerTypesText.
 * This is the shared contract consumed by loadServerTypes.
 */
export interface TypesSourceData extends OrganizeTypesResult<TypesMeta> {
  /** External types discovered in the file */
  externalTypes: Record<string, string>;
  /**
   * Type name map (merged across all variants).
   * Maps flat names (like "AccordionTriggerState") to dotted names (like "Accordion.Trigger.State").
   */
  typeNameMap: Record<string, string>;
  /** All dependencies that should be watched for changes */
  allDependencies: string[];
  /** Whether the types.md file was updated (false if loaded from existing file) */
  updated: boolean;
}

/**
 * Load and parse a types.md file into TypesMeta[].
 *
 * @param fileUrl - file:// URL to the types.md file
 * @returns Parsed types and external types
 */
export async function loadServerTypesText(
  fileUrl: string,
  ordering?: OrderingConfig,
): Promise<TypesSourceData> {
  // Read the file
  const filePath = fileURLToPath(fileUrl);
  const content = await readFile(filePath, 'utf-8');

  return {
    ...(await parseTypesMarkdown(content, ordering)),
    allDependencies: [filePath],
    updated: false,
  };
}
