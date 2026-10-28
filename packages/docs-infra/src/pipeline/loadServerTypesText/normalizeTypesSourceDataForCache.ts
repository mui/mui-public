import type { TypesMeta } from '../loadServerTypesMeta';
import type { TypesSourceData } from './loadServerTypesText';

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
