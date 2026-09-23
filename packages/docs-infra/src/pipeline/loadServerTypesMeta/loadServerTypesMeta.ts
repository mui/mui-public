// Can use node: imports here since this is server-only code
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { extractNameAndSlugFromUrl } from '../loaderUtils';
import { nameMark, performanceMeasure } from '../loadPrecomputedCodeHighlighter/performanceLogger';
import { loadTypescriptConfig } from './loadTypescriptConfig';
import { resolveLibrarySourceFiles } from './resolveLibrarySourceFiles';
import { formatClassData, isPublicClass } from './formatClass';
import type { ClassTypeMeta as ClassType } from './formatClass';
import { formatComponentData, isPublicComponent } from './formatComponent';
import type { ComponentTypeMeta as ComponentType } from './formatComponent';
import { formatHookData, isPublicHook } from './formatHook';
import type { HookTypeMeta as HookType } from './formatHook';
import { formatFunctionData, isPublicFunction } from './formatFunction';
import type { FunctionTypeMeta as FunctionType } from './formatFunction';
import { formatRawData } from './formatRaw';
import type { RawTypeMeta as RawType, ReExportInfo } from './formatRaw';
import { prettyFormat } from './format';
import type {
  FormattedProperty,
  FormattedEnumMember,
  FormattedParameter,
  FormatInlineTypeOptions,
  DescriptionReplacement,
} from './format';
import type { InheritedExternalPropsConfig } from './inheritedExternalProps';
import { buildTypeCompatibilityMap } from './rewriteTypes';
import type { TypeRewriteContext } from './rewriteTypes';
import type { ExternalTypeMeta, ExternalTypesCollector } from './externalTypes';
import { matchConstantGroups } from './constantGroups';
import type { ConstantGroupPatterns } from './constantGroups';
import { getWorkerManager } from './workerManager';
import { reconstructPerformanceLogs } from './performanceTracking';
import { typeSuffixes as defaultTypeSuffixes } from '../loadServerTypesText/order';
import type { OrderingConfig } from '../loadServerTypesText/order';
import { organizeTypesByExport } from '../loadServerTypesText/organizeTypesByExport';
import type { OrganizeTypesResult } from '../loadServerTypesText/organizeTypesByExport';

export type ClassTypeMeta = ClassType;
export type ComponentTypeMeta = ComponentType;
export type HookTypeMeta = HookType;
export type FunctionTypeMeta = FunctionType;
export type RawTypeMeta = RawType;
export type {
  FormatInlineTypeOptions,
  FormattedProperty,
  FormattedEnumMember,
  FormattedParameter,
  ReExportInfo,
  DescriptionReplacement,
};

export type TypesMeta =
  | {
      type: 'class';
      name: string;
      slug?: string;
      /** Alternative names this type can be looked up by (e.g., flat export name like "AccordionRootState") */
      aliases?: string[];
      data: ClassTypeMeta;
    }
  | {
      type: 'component';
      name: string;
      slug?: string;
      /** Alternative names this type can be looked up by (e.g., flat export name like "AccordionRootProps") */
      aliases?: string[];
      data: ComponentTypeMeta;
    }
  | {
      type: 'hook';
      name: string;
      slug?: string;
      /** Alternative names this type can be looked up by */
      aliases?: string[];
      data: HookTypeMeta;
    }
  | {
      type: 'function';
      name: string;
      slug?: string;
      /** Alternative names this type can be looked up by */
      aliases?: string[];
      data: FunctionTypeMeta;
    }
  | {
      type: 'raw';
      name: string;
      slug?: string;
      /** Alternative names this type can be looked up by (e.g., flat export name like "AccordionRootState") */
      aliases?: string[];
      data: RawTypeMeta;
    };

const functionName = 'Load Server Types Meta';

export interface LoadServerTypesMetaOptions {
  /** Absolute path to the types.md file (used for deriving paths) */
  typesMarkdownPath: string;
  /** Root context directory (workspace root) */
  rootContext: string;
  /**
   * Map of variant name to file path (relative or package path).
   * Each variant is an entrypoint whose types are extracted independently then merged.
   * For single component: `{ Default: '@base-ui/react/checkbox' }`
   * For multiple: `{ Checkbox: '@base-ui/react/checkbox', Button: '@base-ui/react/button' }`
   */
  variants?: Record<string, string>;
  /**
   * When true, resolves library paths to their source files for watching.
   * Useful during development to watch the original source rather than built files.
   */
  watchSourceDirectly?: boolean;
  /** Options for formatting types in tables */
  formattingOptions?: FormatInlineTypeOptions;
  /**
   * Optional regex pattern string to filter which external types to include.
   * External types are named union types (like `Orientation = 'horizontal' | 'vertical'`)
   * that are referenced in props but not exported from the component's module.
   *
   * When not provided, ALL qualifying named union types (unions of literals) will be
   * collected automatically. This is the recommended behavior for most projects.
   *
   * When provided, only external types whose names match this pattern will be collected.
   *
   * @example undefined // Collect all qualifying external types (recommended)
   * @example '^(Orientation|Alignment|Side)$' // Only include specific types
   */
  externalTypesPattern?: string;
  /** Custom ordering configuration for sorting props, data attributes, exports, etc. */
  ordering?: OrderingConfig;
  /**
   * Pattern/replacement pairs to apply to JSDoc descriptions.
   * Each entry has a `pattern` (regex string) and `replacement` string.
   */
  descriptionReplacements?: DescriptionReplacement[];
  /**
   * Props to re-include when inherited from these externally declared types,
   * keyed by the declaring type's name. The parser normally drops props that are
   * only declared inside `node_modules`; this re-adds the configured ones.
   *
   * @example { BaseUIComponentProps: ['className', 'render', 'style'] }
   */
  inheritedExternalProps?: InheritedExternalPropsConfig;
  /**
   * Export name patterns marking the constant groups (enums, or namespaces of constants)
   * that hold a component's data attributes or CSS variables. The `*` stands for the
   * component's name with its dots removed. Without patterns, no tables are attached.
   *
   * @example { dataAttributes: '*DataAttributes', cssVariables: '*CssVariables' }
   */
  constantGroupPatterns?: ConstantGroupPatterns;
}

export interface LoadServerTypesMetaResult extends OrganizeTypesResult<TypesMeta> {
  /** All dependencies that should be watched for changes */
  allDependencies: string[];
  /** Type name map from variant processing */
  typeNameMap?: Record<string, string>;
  /**
   * External types discovered during formatting.
   * These are types referenced in props/params that are not publicly exported,
   * but whose definitions are useful for documentation (e.g., union types).
   * Map from type name to its definition string.
   */
  externalTypes: Record<string, string>;
  /** Resource name derived from the types path */
  resourceName: string;
}

/**
 * Loads and formats TypeScript types from source files.
 *
 * This function handles:
 * - Loading TypeScript configuration
 * - Resolving library source files and variants
 * - Finding meta files (DataAttributes, CssVars)
 * - Processing types via worker thread
 * - Formatting component, hook, function, and raw types
 * - Collecting external types referenced in props/params
 *
 * The result can be used by syncTypes for markdown generation or by other consumers.
 */
export async function loadServerTypesMeta(
  options: LoadServerTypesMetaOptions,
): Promise<LoadServerTypesMetaResult> {
  const { typesMarkdownPath, rootContext, variants, watchSourceDirectly, formattingOptions } =
    options;

  // Derive relative path and resource name from inputs
  const relativePath = path.relative(rootContext, typesMarkdownPath);
  const resourceName = extractNameAndSlugFromUrl(
    new URL('.', pathToFileURL(typesMarkdownPath)).pathname,
  ).name;

  // Ensure rootContext always ends with / for correct URL resolution
  const rootContextDir = rootContext.endsWith('/') ? rootContext : `${rootContext}/`;

  let currentMark = nameMark(functionName, 'Start Loading', [relativePath]);
  performance.mark(currentMark);

  const config = await loadTypescriptConfig(path.join(rootContext, 'tsconfig.json'));

  currentMark = performanceMeasure(
    currentMark,
    { mark: 'tsconfig.json loaded', measure: 'tsconfig.json loading' },
    [functionName, relativePath],
  );

  let resolvedVariantMap = new Map<string, string>();
  if (variants) {
    // Ensure pathsBasePath ends with / for correct URL resolution (if defined)
    const pathsBasePath = config.options.pathsBasePath
      ? String(config.options.pathsBasePath)
      : undefined;
    const pathsBaseDir =
      pathsBasePath && (pathsBasePath.endsWith('/') ? pathsBasePath : `${pathsBasePath}/`);
    const result = await resolveLibrarySourceFiles({
      variants,
      resourcePath: typesMarkdownPath,
      rootContextDirUrl: pathToFileURL(rootContextDir).href,
      tsconfigPaths: config.options.paths,
      pathsBaseDir,
      watchSourceDirectly: Boolean(watchSourceDirectly),
    });

    resolvedVariantMap = result.resolvedVariantMap;

    currentMark = performanceMeasure(
      currentMark,
      { mark: 'Paths Resolved', measure: 'Path Resolution' },
      [functionName, relativePath],
    );
  }

  const allEntrypoints = Array.from(resolvedVariantMap.values()).map((url) => fileURLToPath(url));

  // Process types — use the worker manager singleton (which adapts to main vs worker thread)
  const workerManager = getWorkerManager();
  const workerStartTime = performance.now();

  const workerResult = await workerManager.processTypes({
    projectPath: config.projectPath,
    compilerOptions: config.options,
    allEntrypoints,
    resolvedVariantMap: Array.from(resolvedVariantMap.entries()),
    dependencies: config.dependencies,
    rootContextDir,
    relativePath,
    inheritedExternalProps: options.inheritedExternalProps,
  });

  if (!workerResult.success) {
    throw new Error(workerResult.error || 'Worker failed to process types');
  }

  // Reconstruct worker performance logs in main thread
  // Note: Worker logs already include relativePath in their names,
  // so they'll be automatically filtered by the PerformanceObserver
  if (workerResult.performanceLogs) {
    reconstructPerformanceLogs(workerResult.performanceLogs, workerStartTime);
  }

  currentMark = performanceMeasure(
    currentMark,
    { prefix: 'worker', mark: 'processed', measure: 'processing' },
    [functionName, relativePath],
    true,
  );

  const rawVariantData = workerResult.variantData || {};
  const allDependencies = workerResult.allDependencies || [];

  // Format the raw exports from the worker into TypesMeta
  const variantData: Record<string, { types: TypesMeta[]; typeNameMap?: Record<string, string> }> =
    {};

  // Create external types collector — shared across all formatting calls.
  // External types are collected during formatting as type names are encountered
  // in the formatted output, eliminating the need for a separate tree walk + filtering step.
  const collectedExternalTypes = new Map<string, ExternalTypeMeta>();

  // Parse external types pattern once if provided
  const externalTypesPatternRegex = options.externalTypesPattern
    ? new RegExp(options.externalTypesPattern)
    : undefined;

  // Build type compatibility map once from all exports across all variants
  // This map is used to rewrite type references (e.g., Dialog.Trigger.State -> AlertDialog.Trigger.State)
  const allRawExports = Object.values(rawVariantData).flatMap((v) => v.allTypes);
  const allExportNames = Array.from(new Set(allRawExports.map((exp) => exp.name)));
  const typeCompatibilityMap = buildTypeCompatibilityMap(allRawExports, allExportNames);

  // Build merged typeNameMap from all variants for type string rewriting
  // typeNameMap maps flat names like "AlertDialogTriggerState" to dotted names like "AlertDialog.Trigger.State"
  const mergedTypeNameMapForRewrite: Record<string, string> = {};
  for (const variant of Object.values(rawVariantData)) {
    if (variant.typeNameMap) {
      Object.assign(mergedTypeNameMapForRewrite, variant.typeNameMap);
    }
  }

  const rewriteContext: TypeRewriteContext = {
    typeCompatibilityMap,
    exportNames: allExportNames,
    typeNameMap:
      Object.keys(mergedTypeNameMapForRewrite).length > 0 ? mergedTypeNameMapForRewrite : undefined,
  };

  // Process all variants in parallel
  await Promise.all(
    Object.entries(rawVariantData).map(async ([variantName, variantResult]) => {
      // Create a per-variant external types collector.
      // Each variant shares the same collected map so types are deduplicated automatically.
      const externalTypesCollector: ExternalTypesCollector = {
        collected: collectedExternalTypes,
        allExports: variantResult.allTypes,
        pattern: externalTypesPatternRegex,
        typeNameMap: variantResult.typeNameMap,
      };

      const constantGroups = matchConstantGroups(
        variantResult.exports,
        options.constantGroupPatterns,
      );

      // Process all exports in parallel within each variant
      const types = await Promise.all(
        variantResult.exports.map(async (exportNode): Promise<TypesMeta> => {
          if (isPublicComponent(exportNode)) {
            const formattedData = await formatComponentData(
              exportNode,
              variantResult.allTypes,
              variantResult.typeNameMap || {},
              rewriteContext,
              {
                formatting: formattingOptions,
                externalTypes: externalTypesCollector,
                ordering: options.ordering,
                constantGroups,
                descriptionReplacements: options.descriptionReplacements,
              },
            );

            return {
              type: 'component',
              name: exportNode.name,
              data: formattedData,
            };
          }

          if (isPublicHook(exportNode)) {
            const formattedData = await formatHookData(
              exportNode,
              variantResult.typeNameMap || {},
              rewriteContext,
              {
                formatting: formattingOptions,
                externalTypes: externalTypesCollector,
                descriptionReplacements: options.descriptionReplacements,
              },
            );

            return {
              type: 'hook',
              name: exportNode.name,
              data: formattedData,
            };
          }

          if (isPublicFunction(exportNode)) {
            const formattedData = await formatFunctionData(
              exportNode,
              variantResult.typeNameMap || {},
              rewriteContext,
              {
                formatting: formattingOptions,
                externalTypes: externalTypesCollector,
                descriptionReplacements: options.descriptionReplacements,
              },
            );

            return {
              type: 'function',
              name: exportNode.name,
              data: formattedData,
            };
          }

          if (isPublicClass(exportNode)) {
            const formattedData = await formatClassData(
              exportNode,
              variantResult.typeNameMap || {},
              rewriteContext,
              {
                formatting: formattingOptions,
                externalTypes: externalTypesCollector,
                descriptionReplacements: options.descriptionReplacements,
              },
            );

            return {
              type: 'class',
              name: exportNode.name,
              data: formattedData,
            };
          }

          // For all other types (type aliases, interfaces, enums), format as raw
          const formattedData = await formatRawData(
            exportNode,
            exportNode.name,
            variantResult.typeNameMap || {},
            rewriteContext,
            {
              formatting: formattingOptions,
              externalTypes: externalTypesCollector,
              descriptionReplacements: options.descriptionReplacements,
            },
          );

          // A constant group tagged for a component is documented as a link to its table
          const target = constantGroups.get(exportNode.name);
          const targetName = target?.component.split('.').pop();

          return {
            type: 'raw',
            name: exportNode.name,
            data:
              target && targetName
                ? {
                    ...formattedData,
                    reExportOf: {
                      name: targetName,
                      slug: `#${targetName.toLowerCase()}`,
                      suffix: target.kind,
                    },
                  }
                : formattedData,
          };
        }),
      );

      variantData[variantName] = { types, typeNameMap: variantResult.typeNameMap };
    }),
  );

  // Group types by component name when there's a single Default variant with sub-components
  // This creates per-component groupings (e.g., "Accordion.Root", "Accordion.Header")
  // For multi-variant cases (CssModules, Tailwind), keep the original structure
  //
  // Key distinction:
  // - Accordion: Has sub-components like Accordion.Root, Accordion.Trigger -> group by sub-component
  // - Button: Just Button with Button.Props, Button.State -> all stay in "Default"
  //
  // We detect this by checking if there are any 2-part names that are NOT suffixes.
  // If all 2-part names are just type suffixes (Props, State, etc.), keep everything in Default.
  const variantNames = Object.keys(variantData);
  if (variantNames.length === 1 && variantNames[0] === 'Default') {
    const defaultData = variantData.Default;

    // Check if there are actual sub-components (2-part names that are NOT suffixes)
    // e.g., "Accordion.Root" is a sub-component, but "Button.Props" is just a suffix
    // and "Form.ValidationMode" is a raw type, not a sub-component
    const hasSubComponents = defaultData.types.some((t) => {
      const parts = t.name.split('.');
      if (parts.length !== 2) {
        return false;
      }
      // It's a sub-component if:
      // 1. The second part is NOT a type suffix, AND
      // 2. It's an actual component/hook/function/class (not a raw type)
      return (
        !(options.ordering?.typeSuffixes ?? defaultTypeSuffixes).includes(parts[1]) &&
        (t.type === 'component' || t.type === 'hook' || t.type === 'function' || t.type === 'class')
      );
    });

    if (hasSubComponents) {
      // Group types by component name
      const groupedVariantData: typeof variantData = {};

      for (const typeMeta of defaultData.types) {
        // Determine the component group name:
        // - 3+ parts (e.g., "Accordion.Root.State"): first two parts ("Accordion.Root")
        // - 2 parts AND it's a component/hook/function/class (e.g., "Accordion.Root", "Progress.Value"): both parts
        // - 2 parts AND it's a raw type (e.g., "Toolbar.Orientation", "Field.ValidityData"): "Default" group
        // - 1 part (e.g., "DirectionProvider"): "Default" group
        let groupName: string;
        const parts = typeMeta.name.split('.');
        if (parts.length >= 3) {
          groupName = `${parts[0]}.${parts[1]}`;
        } else if (parts.length === 2) {
          if (
            typeMeta.type === 'component' ||
            typeMeta.type === 'hook' ||
            typeMeta.type === 'function' ||
            typeMeta.type === 'class'
          ) {
            // Actual sub-component like Accordion.Root, Progress.Value -> group under full name
            groupName = typeMeta.name;
          } else {
            // Raw type like Toolbar.Orientation, Field.ValidityData -> group under "Default"
            groupName = 'Default';
          }
        } else {
          groupName = 'Default';
        }

        if (!groupedVariantData[groupName]) {
          groupedVariantData[groupName] = {
            types: [],
            typeNameMap: defaultData.typeNameMap,
          };
        }
        groupedVariantData[groupName].types.push(typeMeta);
      }

      // Replace variantData with grouped version
      // Clear and repopulate to maintain the same object reference
      for (const key of Object.keys(variantData)) {
        delete variantData[key];
      }
      Object.assign(variantData, groupedVariantData);
    }
  }

  currentMark = performanceMeasure(
    currentMark,
    { mark: 'formatting complete', measure: 'type formatting' },
    [functionName, relativePath],
  );

  // Collect all types for further processing
  let allTypes = Object.values(variantData).flatMap((v) => v.types);

  // Deduplicate types by name - can happen when same component is exported from multiple entrypoints
  // (e.g., DirectionProvider exported from both index.ts and DirectionProvider.tsx)
  // Prefer components/hooks over other types when there are duplicates
  const typesByName = new Map<string, TypesMeta>();
  allTypes.forEach((typeMeta) => {
    const existing = typesByName.get(typeMeta.name);
    if (!existing) {
      typesByName.set(typeMeta.name, typeMeta);
    } else if (typeMeta.type === 'component' || typeMeta.type === 'hook') {
      // Prefer components/hooks over other types
      typesByName.set(typeMeta.name, typeMeta);
    }
    // else: keep existing entry (don't replace with 'other' type)
  });
  allTypes = Array.from(typesByName.values());

  // Merge typeNameMaps from all variants for filtering
  // typeNameMap maps flat names like "AccordionItemChangeEventReason" to dotted names like "Accordion.Item.ChangeEventReason"
  // While variants typically have identical mappings (they parse the same source), merging ensures completeness
  const mergedTypeNameMap: Record<string, string> = {};
  for (const variant of Object.values(variantData)) {
    if (variant.typeNameMap) {
      Object.assign(mergedTypeNameMap, variant.typeNameMap);
    }
  }

  // Filter out flat-named types when a corresponding namespaced version exists
  // e.g., if we have "Accordion.Item.ChangeEventReason" (namespaced), filter out "AccordionItemChangeEventReason" (flat)
  // Build a set of all dotted names that exist in allTypes
  const existingDottedNames = new Set<string>();
  for (const typeMeta of allTypes) {
    if (typeMeta.name.includes('.')) {
      existingDottedNames.add(typeMeta.name);
    }
  }

  // Filter out flat types that have a namespaced equivalent
  allTypes = allTypes.filter((typeMeta) => {
    // Keep namespaced types
    if (typeMeta.name.includes('.')) {
      return true;
    }
    // Check if this flat type has a corresponding dotted name in typeNameMap
    const dottedName = mergedTypeNameMap[typeMeta.name];
    if (!dottedName) {
      // No mapping found, keep the type
      return true;
    }
    // Check if the full dotted name exists in our types
    // e.g., if typeNameMap says AccordionItemChangeEventReason → Accordion.Item.ChangeEventReason
    // and we have Accordion.Item.ChangeEventReason in existingDottedNames, filter out the flat version
    return !existingDottedNames.has(dottedName);
  });

  // Attach aliases from typeNameMap to namespaced types so they can also be looked up by their flat name
  // e.g., "Accordion.Item.ChangeEventDetails" gets alias "AccordionItemChangeEventDetails"
  // The flat name is confirmed to be a real export (typeNameMap only contains verified exports)
  const dottedToFlatNames = new Map<string, string[]>();
  for (const [flatName, dottedName] of Object.entries(mergedTypeNameMap)) {
    // Only add aliases for flat names that were actually filtered out (i.e., the dotted version exists)
    if (existingDottedNames.has(dottedName)) {
      const existing = dottedToFlatNames.get(dottedName);
      if (existing) {
        existing.push(flatName);
      } else {
        dottedToFlatNames.set(dottedName, [flatName]);
      }
    }
  }
  if (dottedToFlatNames.size > 0) {
    allTypes = allTypes.map((typeMeta) => {
      const flatAliases = dottedToFlatNames.get(typeMeta.name);
      if (flatAliases) {
        return { ...typeMeta, aliases: flatAliases };
      }
      return typeMeta;
    });
  }

  // Detect re-exports: check if type exports (like ButtonProps) are just re-exports of component props
  // For 'raw' types, update the data.reExportOf field
  allTypes = allTypes.map((typeMeta) => {
    if (typeMeta.type !== 'raw') {
      return typeMeta;
    }

    // Skip if already marked as a re-export
    if (typeMeta.data.reExportOf) {
      return typeMeta;
    }

    // Extract component name and suffix (e.g., "ButtonProps" -> component: "Button", suffix: "Props")
    // Handle both namespaced (ContextMenu.Root.Props) and non-namespaced (ButtonProps) names
    const parts = typeMeta.name.match(/^(.+)\.(Props|State)$/);
    if (!parts) {
      return typeMeta;
    }

    const [, componentName, suffix] = parts;

    // Find the corresponding component by checking both the full name and just the last part
    // e.g., for "ContextMenu.Root.Props", check both "ContextMenu.Root" and "Root"
    const correspondingComponent = allTypes.find(
      (t) =>
        t.type === 'component' &&
        (t.name === componentName || t.name.endsWith(`.${componentName}`)),
    );

    if (!correspondingComponent || correspondingComponent.type !== 'component') {
      return typeMeta;
    }

    // Check if Props is a re-export of the component's props
    if (suffix === 'Props' && correspondingComponent.data.props) {
      const hasProps = Object.keys(correspondingComponent.data.props).length > 0;
      if (hasProps) {
        // Extract the display name (last part after dot) for the link text
        const displayName = componentName.includes('.')
          ? componentName.split('.').pop()!
          : componentName;
        // Mark this as a re-export by updating the data
        return {
          type: 'raw' as const,
          name: typeMeta.name,
          data: {
            ...typeMeta.data,
            reExportOf: {
              name: displayName,
              slug: `#${displayName.toLowerCase()}`,
              suffix: 'props' as const,
            },
          },
        };
      }
    }

    return typeMeta;
  });

  // Update variantData with the modified types (with reExportOf set)
  // allTypes was modified by the re-export detection above, but variantData still references the old objects
  // Create a lookup map from the updated allTypes
  const updatedTypesByName = new Map<string, TypesMeta>();
  for (const typeMeta of allTypes) {
    updatedTypesByName.set(typeMeta.name, typeMeta);
  }
  // Update each variant's types array with the modified types
  for (const variant of Object.values(variantData)) {
    variant.types = variant.types.map((typeMeta) => {
      const updated = updatedTypesByName.get(typeMeta.name);
      return updated ?? typeMeta;
    });
  }

  // Get typeNameMap from first variant (they should all be the same)
  const typeNameMap = Object.values(variantData)[0]?.typeNameMap;

  // External types were collected during formatting — no separate filtering needed.
  // The collection happens in formatType() which only encounters types that appear
  // in the formatted output, so every collected type is actually referenced.

  // Convert collected external types to a simple Record<string, string>, formatted with prettier.
  // Store the full declaration (e.g., `type NAME = ...;`) so generateTypesMarkdown uses it as-is.
  const externalTypes: Record<string, string> = {};
  await Promise.all(
    Array.from(collectedExternalTypes.entries()).map(async ([name, meta]) => {
      const formatted = await prettyFormat(meta.definition, name);
      externalTypes[name] = formatted.trimEnd();
    }),
  );

  performanceMeasure(
    currentMark,
    { mark: 'complete', measure: 'total processing' },
    [functionName, relativePath],
    true,
  );

  // Organize types into exports structure for UI consumption
  const organized = organizeTypesByExport(variantData, typeNameMap, options.ordering);

  return {
    allDependencies,
    typeNameMap,
    externalTypes,
    resourceName,
    exports: organized.exports,
    additionalTypes: organized.additionalTypes,
    variantOnlyAdditionalTypes: organized.variantOnlyAdditionalTypes,
    variantTypeNames: organized.variantTypeNames,
    variantTypeNameMaps: organized.variantTypeNameMaps,
  };
}
