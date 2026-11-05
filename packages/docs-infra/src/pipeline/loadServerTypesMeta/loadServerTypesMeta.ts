// Can use node: imports here since this is server-only code
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ExternalTypeSource } from '@mui/internal-typescript-api-extractor';

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
import { getMdnTypeLink } from './mdnTypeLinks';
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

/** The fields every documented type has, whatever its kind. */
interface TypesMetaBase {
  name: string;
  slug?: string;
  /**
   * The other names the type is exported under, which it can also be looked up by: flat
   * spellings of a namespaced name (`AccordionRootProps` for `Accordion.Root.Props`) and
   * other exports of the same declaration (`compressString` for `compressHast`). types.md
   * lists them under the type's section.
   */
  aliases?: string[];
  /**
   * An opaque id of the declaration the type documents, from the extractor's
   * `ExportNode.declarationId`. Compare ids only for equality; they are stable across runs
   * as a best effort, with no guarantee. types.md does not record it, so types read back
   * from types.md have none.
   */
  declarationId?: string;
}

export type TypesMeta = TypesMetaBase &
  (
    | { type: 'class'; data: ClassTypeMeta }
    | { type: 'component'; data: ComponentTypeMeta }
    | { type: 'hook'; data: HookTypeMeta }
    | { type: 'function'; data: FunctionTypeMeta }
    | { type: 'raw'; data: RawTypeMeta }
  );

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
}

export interface LoadServerTypesMetaResult extends OrganizeTypesResult<TypesMeta> {
  /** All dependencies that should be watched for changes */
  allDependencies: string[];
  /**
   * External types discovered during formatting.
   * These are types referenced in props/params that are not publicly exported,
   * but whose definitions are useful for documentation (e.g., union types).
   * Map from type name to its definition string.
   */
  externalTypes: Record<string, string>;
  /**
   * Links for the built-in types in the formatted output, keyed by the name they are printed
   * as, such as `HTMLElement` to its MDN page.
   */
  externalTypeLinks: Record<string, string>;
  /** Resource name derived from the types path */
  resourceName: string;
}

/**
 * Loads and formats TypeScript types from source files.
 *
 * This function handles:
 * - Loading TypeScript configuration
 * - Resolving library source files and variants
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

  // Process types — use the worker manager singleton (which adapts to main vs worker thread)
  const workerManager = getWorkerManager();
  const workerStartTime = performance.now();

  const workerResult = await workerManager.processTypes({
    projectPath: config.projectPath,
    compilerOptions: config.options,
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
  const variantData: Record<string, { types: TypesMeta[] }> = {};

  // Create external types collector — shared across all formatting calls.
  // External types are collected during formatting as type names are encountered
  // in the formatted output, eliminating the need for a separate tree walk + filtering step.
  const collectedExternalTypes = new Map<string, ExternalTypeMeta>();
  const collectedExternalTypeSources = new Map<string, ExternalTypeSource | null>();

  // Parse external types pattern once if provided
  const externalTypesPatternRegex = options.externalTypesPattern
    ? new RegExp(options.externalTypesPattern)
    : undefined;

  // Build type compatibility map once from all exports across all variants
  // This map is used to rewrite type references (e.g., Dialog.Trigger.State -> AlertDialog.Trigger.State)
  const allRawExports = Object.values(rawVariantData).flatMap((v) => v.exports);
  const allExportNames = Array.from(new Set(allRawExports.map((exp) => exp.name)));
  // Aliases are public exports too, so types extending one are not rewritten to the extender.
  const allAliasNames = Object.values(rawVariantData).flatMap((v) => Object.keys(v.aliases ?? {}));
  const typeCompatibilityMap = buildTypeCompatibilityMap(allRawExports, [
    ...allExportNames,
    ...allAliasNames,
  ]);

  const rewriteContext: TypeRewriteContext = {
    typeCompatibilityMap,
    exportNames: allExportNames,
  };

  // Process all variants in parallel
  await Promise.all(
    Object.entries(rawVariantData).map(async ([variantName, variantResult]) => {
      // Create a per-variant external types collector.
      // Each variant shares the same collected map so types are deduplicated automatically.
      const externalTypesCollector: ExternalTypesCollector = {
        collected: collectedExternalTypes,
        sources: collectedExternalTypeSources,
        allExports: variantResult.exports,
        pattern: externalTypesPatternRegex,
      };

      const constantGroups = matchConstantGroups(variantResult.exports);
      const constantNamespaces = new Set(variantResult.constantNamespaces);

      // Process all exports in parallel within each variant
      const types = await Promise.all(
        variantResult.exports.map(async (exportNode): Promise<TypesMeta> => {
          if (isPublicComponent(exportNode)) {
            const formattedData = await formatComponentData(exportNode, rewriteContext, {
              formatting: formattingOptions,
              externalTypes: externalTypesCollector,
              ordering: options.ordering,
              constantGroups: constantGroups.byComponent.get(exportNode.name),
              descriptionReplacements: options.descriptionReplacements,
            });

            return {
              type: 'component',
              name: exportNode.name,
              data: formattedData,
            };
          }

          if (isPublicHook(exportNode)) {
            const formattedData = await formatHookData(exportNode, rewriteContext, {
              formatting: formattingOptions,
              externalTypes: externalTypesCollector,
              descriptionReplacements: options.descriptionReplacements,
            });

            return {
              type: 'hook',
              name: exportNode.name,
              data: formattedData,
            };
          }

          if (isPublicFunction(exportNode)) {
            const formattedData = await formatFunctionData(exportNode, rewriteContext, {
              formatting: formattingOptions,
              externalTypes: externalTypesCollector,
              descriptionReplacements: options.descriptionReplacements,
            });

            return {
              type: 'function',
              name: exportNode.name,
              data: formattedData,
            };
          }

          if (isPublicClass(exportNode)) {
            const formattedData = await formatClassData(exportNode, rewriteContext, {
              formatting: formattingOptions,
              externalTypes: externalTypesCollector,
              descriptionReplacements: options.descriptionReplacements,
            });

            return {
              type: 'class',
              name: exportNode.name,
              data: formattedData,
            };
          }

          // For all other types (type aliases, interfaces, enums), format as raw
          const formattedData = await formatRawData(exportNode, exportNode.name, rewriteContext, {
            formatting: formattingOptions,
            externalTypes: externalTypesCollector,
            descriptionReplacements: options.descriptionReplacements,
            constantGroup: constantGroups.targets.get(exportNode.name),
            constantNamespace: constantNamespaces.has(exportNode.name),
          });

          return {
            type: 'raw',
            name: exportNode.name,
            data: formattedData,
          };
        }),
      );

      variantData[variantName] = {
        types: types.map((typeMeta, index) => {
          const { declarationId } = variantResult.exports[index];
          return declarationId === undefined ? typeMeta : { ...typeMeta, declarationId };
        }),
      };
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
          groupedVariantData[groupName] = { types: [] };
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

  // Attach the other names each type is exported under, from all variants: the exports reaching
  // the same declaration ("AccordionItemChangeEventDetails" for "Accordion.Item.ChangeEventDetails",
  // "compressString" for "compressHast"), so they can also be looked up by those names
  const otherNames = new Map<string, Set<string>>();
  for (const variant of Object.values(rawVariantData)) {
    for (const [aliasName, canonicalName] of Object.entries(variant.aliases ?? {})) {
      const names = otherNames.get(canonicalName) ?? new Set<string>();
      names.add(aliasName);
      otherNames.set(canonicalName, names);
    }
  }
  if (otherNames.size > 0) {
    allTypes = allTypes.map((typeMeta) => {
      const aliases = otherNames.get(typeMeta.name);
      return aliases ? { ...typeMeta, aliases: [...aliases].sort() } : typeMeta;
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
    const parts = typeMeta.name.match(/^(.+)\.Props$/);
    if (!parts) {
      return typeMeta;
    }

    const [, componentName] = parts;

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
    if (correspondingComponent.data.props) {
      const hasProps = Object.keys(correspondingComponent.data.props).length > 0;
      if (hasProps) {
        // Extract the display name (last part after dot) for the link text
        const displayName = componentName.includes('.')
          ? componentName.split('.').pop()!
          : componentName;
        // Mark this as a re-export by updating the data
        return {
          ...typeMeta,
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

  const externalTypeLinks: Record<string, string> = {};
  for (const [name, source] of [...collectedExternalTypeSources].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const link = source ? getMdnTypeLink(name, source) : undefined;
    if (link) {
      externalTypeLinks[name] = link;
    }
  }

  performanceMeasure(
    currentMark,
    { mark: 'complete', measure: 'total processing' },
    [functionName, relativePath],
    true,
  );

  // Organize types into exports structure for UI consumption
  const organized = organizeTypesByExport(variantData, options.ordering);

  return {
    allDependencies,
    externalTypes,
    externalTypeLinks,
    resourceName,
    exports: organized.exports,
    additionalTypes: organized.additionalTypes,
    variantOnlyAdditionalTypes: organized.variantOnlyAdditionalTypes,
    variantTypeNames: organized.variantTypeNames,
  };
}
