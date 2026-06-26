import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { withFileCache } from '../cacheUtils';
import type { FileCacheRef } from '../cacheUtils';
import type { TypesMeta } from '../loadServerTypesMeta';
import type { OrganizeTypesResult } from './organizeTypesByExport';
import { parseTypesMarkdown } from './parseTypesMarkdown';
import {
  TYPES_TEXT_CACHE_NAMESPACE,
  resolveTypesCacheKey,
  buildTypesTextCacheContent,
} from './resolveTypesCacheKey';
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
 * Options for the types.md parse cache.
 *
 * When both are set, the parse of types.md is cached at `{cacheDir}/types-text/{route}.json`,
 * keyed by the sha256 of the file content (plus ordering), mirroring the page-index cache.
 */
export interface LoadServerTypesTextCacheOptions {
  /** Directory for the sha256-validated JSON cache of parsed types.md files. */
  cacheDir?: string;
  /** Root context directory used to derive the cache key/route. */
  rootContext?: string;
}

function stripPositionFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripPositionFields);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'position') {
      continue;
    }
    const normalized = stripPositionFields(child);
    if (normalized !== undefined) {
      result[key] = normalized;
    }
  }
  return result;
}

function normalizeTypeMetaForCache(typeMeta: TypesMeta): TypesMeta {
  if (typeMeta.type === 'component') {
    const { name, props, dataAttributes, cssVariables, descriptionText, description, ...rest } =
      typeMeta.data;
    return {
      ...typeMeta,
      data: {
        name,
        props,
        dataAttributes,
        cssVariables,
        ...(descriptionText ? { descriptionText } : {}),
        ...(description ? { description } : {}),
        ...rest,
      },
    };
  }

  if (typeMeta.type === 'hook' || typeMeta.type === 'function') {
    const {
      name,
      parameters,
      expandedProperties,
      returnValue,
      descriptionText,
      description,
      returnValueDescriptionText,
      returnValueDescription,
      ...rest
    } = typeMeta.data;
    return {
      ...typeMeta,
      data: {
        name,
        ...(expandedProperties ? { expandedProperties } : { parameters }),
        returnValue,
        ...(descriptionText ? { descriptionText } : {}),
        ...(description ? { description } : {}),
        ...(returnValueDescriptionText ? { returnValueDescriptionText } : {}),
        ...(returnValueDescription ? { returnValueDescription } : {}),
        ...rest,
      },
    };
  }

  if (typeMeta.type === 'raw') {
    const { name, formattedCode, descriptionText, description, reExportOf, ...rest } =
      typeMeta.data;
    return {
      ...typeMeta,
      data: {
        name,
        formattedCode,
        ...(descriptionText ? { descriptionText } : {}),
        ...(description ? { description } : {}),
        ...(reExportOf ? { reExportOf } : {}),
        ...rest,
      },
    };
  }

  return typeMeta;
}

function normalizeTypesByExportForCache(
  exports: TypesSourceData['exports'],
): TypesSourceData['exports'] {
  const normalized: TypesSourceData['exports'] = {};
  for (const [exportName, exportData] of Object.entries(exports)) {
    normalized[exportName] = {
      type: normalizeTypeMetaForCache(exportData.type),
      additionalTypes: exportData.additionalTypes.map(normalizeTypeMetaForCache),
    };
  }
  return normalized;
}

function normalizeVariantOnlyTypesForCache(
  variantOnlyAdditionalTypes: TypesSourceData['variantOnlyAdditionalTypes'],
): TypesSourceData['variantOnlyAdditionalTypes'] {
  const normalized: TypesSourceData['variantOnlyAdditionalTypes'] = {};
  for (const [variantName, types] of Object.entries(variantOnlyAdditionalTypes)) {
    normalized[variantName] = types.map(normalizeTypeMetaForCache);
  }
  return normalized;
}

/**
 * Normalizes source-derived TypesSourceData so its JSON cache payload matches a
 * cold parse of the generated types.md without reparsing that markdown.
 */
export function normalizeTypesSourceDataForCache(data: TypesSourceData): TypesSourceData {
  return stripPositionFields({
    exports: normalizeTypesByExportForCache(data.exports),
    additionalTypes: data.additionalTypes.map(normalizeTypeMetaForCache),
    variantOnlyAdditionalTypes: normalizeVariantOnlyTypesForCache(data.variantOnlyAdditionalTypes),
    externalTypes: data.externalTypes,
    typeNameMap: data.typeNameMap,
    variantTypeNameMaps: data.variantTypeNameMaps,
    variantTypeNames: data.variantTypeNames,
    allDependencies: data.allDependencies,
    updated: data.updated,
  }) as TypesSourceData;
}

/**
 * Load and parse a types.md file into TypesMeta[].
 *
 * @param fileUrl - file:// URL to the types.md file
 * @param ordering - optional ordering config that affects how types are sorted
 * @param cache - optional parse-cache configuration
 * @returns Parsed types and external types
 */
export function loadServerTypesText(
  fileUrl: string,
  ordering?: OrderingConfig,
  cache?: LoadServerTypesTextCacheOptions,
): Promise<TypesSourceData> {
  const filePath = fileURLToPath(fileUrl);

  const cacheRef: FileCacheRef | undefined =
    cache?.cacheDir && cache.rootContext
      ? {
          cacheDir: cache.cacheDir,
          namespace: TYPES_TEXT_CACHE_NAMESPACE,
          cacheKey: resolveTypesCacheKey(filePath, cache.rootContext),
        }
      : undefined;

  // The cache stores the parsed TypesSourceData keyed by the markdown + ordering hash, so a hit
  // skips parseTypesMarkdown (the expensive step).
  return withFileCache({
    ref: cacheRef,
    readOrigin: () => readFile(filePath, 'utf-8'),
    getCacheContent: (content) => buildTypesTextCacheContent(content, ordering),
    processor: async (content) => ({
      ...(await parseTypesMarkdown(content, ordering)),
      allDependencies: [filePath],
      updated: false,
    }),
  });
}
