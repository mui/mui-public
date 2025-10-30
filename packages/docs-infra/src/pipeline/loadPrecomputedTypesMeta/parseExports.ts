import ts from 'typescript';
import type { Program, SourceFile, TypeChecker } from 'typescript';
import { parseFromProgram, type ExportNode, type ParserOptions } from 'typescript-api-extractor';
import { appendFileSync } from 'node:fs';

type ReExportInfo = {
  sourceFile: SourceFile;
  aliasMap: Map<string, string>; // Maps original name -> exported name
  namespaceName?: string; // For `export * as X`
};

export type ParsedReExports = {
  name: string;
  exports: ExportNode[];
  typeNameMap: Map<string, string>; // Maps flat type names to dotted names
  isExternal?: boolean; // Flag for externally imported modules
  sourceFilePaths?: string[]; // Source file paths that were processed (for collecting adjacent files)
};

/**
 * Extracts namespace members from TypeScript namespace declarations.
 * For example, from `export namespace Component { export type State = ...; export type Props = ...; }`
 * returns Map { 'State' => 'ComponentState', 'Props' => 'ComponentProps' }
 */
function extractNamespaceMembers(sourceFile: SourceFile): Map<string, Map<string, string>> {
  const namespaceMembers = new Map<string, Map<string, string>>();

  function visit(node: ts.Node) {
    // Look for: export namespace ComponentName { ... }
    if (ts.isModuleDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      const namespaceName = node.name.text;
      const members = new Map<string, string>();

      if (node.body && ts.isModuleBlock(node.body)) {
        for (const statement of node.body.statements) {
          // Look for: export type MemberName = FlatTypeName
          if (
            ts.isTypeAliasDeclaration(statement) &&
            statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
          ) {
            const memberName = statement.name.text; // e.g., "State"

            // Extract the RHS of the type alias (e.g., "MenuRadioItemState")
            // from "export type State = MenuRadioItemState"
            if (statement.type && ts.isTypeReferenceNode(statement.type)) {
              const typeName = statement.type.typeName;
              if (ts.isIdentifier(typeName)) {
                const flatTypeName = typeName.text; // e.g., "MenuRadioItemState"
                members.set(memberName, flatTypeName);
              }
            }
          }
        }
      }

      if (members.size > 0) {
        namespaceMembers.set(namespaceName, members);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return namespaceMembers;
}

export function parseExports(
  sourceFile: SourceFile,
  checker: TypeChecker,
  program: Program,
  parserOptions: ParserOptions,
  visited: Set<string> = new Set(),
  parentNamespaceName?: string,
): ParsedReExports[] {
  const fileName = sourceFile.fileName;

  // Prevent infinite recursion
  if (visited.has(fileName)) {
    return [];
  }
  visited.add(fileName);

  const allResults: ParsedReExports[] = [];
  const sourceFileSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
  const exportedSymbols = sourceFileSymbol && checker.getExportsOfModule(sourceFileSymbol);

  // DEBUG: Log file being processed
  if (sourceFile.fileName.includes('context-menu/index.parts')) {
    console.warn('[parseExports] ===== Processing file:', sourceFile.fileName);
    console.warn('[parseExports] Found', exportedSymbols?.length || 0, 'export symbols');
  }

  if (!exportedSymbols) {
    return [];
  }

  const reExportInfos: ReExportInfo[] = [];

  // First, check for `export *` declarations at the statement level
  // These are barrel exports that re-export everything from another module
  sourceFile.statements.forEach((statement) => {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      !statement.exportClause // `export *` has no exportClause
    ) {
      // This is an `export * from './file'` statement
      const importedSymbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
      const importedSourceFile = importedSymbol?.valueDeclaration?.getSourceFile();

      if (importedSourceFile) {
        reExportInfos.push({
          sourceFile: importedSourceFile,
          aliasMap: new Map(), // No aliasing for `export *`
        });
      }
    }
  });

  // Check each exported symbol
  exportedSymbols.forEach((symbol) => {
    const declarations = symbol.declarations;

    if (!declarations || declarations.length === 0) {
      return;
    }

    // Look for a NamespaceExport in any of the declarations
    const namespaceExportDecl = declarations.find((d) => ts.isNamespaceExport(d));
    const exportSpecifierDecl = declarations.find((d) => ts.isExportSpecifier(d));

    // Check if it's a NamespaceExport (like `export * as Component from './index.parts'`)
    // This should be checked FIRST because TypeScript creates synthetic ExportSpecifiers
    // for namespace exports, which don't have a moduleSpecifier
    if (namespaceExportDecl) {
      // DEBUG: Log for Toolbar and ContextMenu
      if (
        sourceFile.fileName.includes('toolbar/index') ||
        sourceFile.fileName.includes('context-menu/index')
      ) {
        console.warn('[parseExports] Found NamespaceExport for symbol:', symbol.name);
      }

      const exportDecl = namespaceExportDecl.parent;

      if (ts.isExportDeclaration(exportDecl) && exportDecl.moduleSpecifier) {
        const moduleSpecifier = exportDecl.moduleSpecifier;

        if (ts.isStringLiteral(moduleSpecifier)) {
          // Get the source file of the module being re-exported
          const importedSymbol = checker.getSymbolAtLocation(moduleSpecifier);
          const importedSourceFile = importedSymbol?.valueDeclaration?.getSourceFile();

          if (importedSourceFile) {
            const namespaceName = symbol.name;

            // DEBUG: Log for Toolbar
            if (sourceFile.fileName.includes('toolbar/index.ts')) {
              console.warn('[parseExports] Creating namespace reExport with name:', namespaceName);
              console.warn('[parseExports] Source file:', importedSourceFile.fileName);
            }

            // For namespace exports, store the namespace name
            reExportInfos.push({
              sourceFile: importedSourceFile,
              aliasMap: new Map(),
              namespaceName,
            });
          }
        }
      }
    }
    // Check if it's an ExportSpecifier (like `export { X as Y } from './file'`)
    // Note: NamespaceExports create synthetic ExportSpecifiers, so we check NamespaceExport first
    else if (exportSpecifierDecl) {
      const exportDecl = exportSpecifierDecl.parent.parent;
      if (ts.isExportDeclaration(exportDecl) && exportDecl.moduleSpecifier) {
        const moduleSpecifier = exportDecl.moduleSpecifier;

        if (ts.isStringLiteral(moduleSpecifier)) {
          // Resolve the imported module to get its source file
          const resolvedModule = checker.getSymbolAtLocation(moduleSpecifier);
          const importedSourceFile = resolvedModule?.declarations?.[0]?.getSourceFile();

          if (importedSourceFile) {
            // Get the original name (before 'as') and the exported name (after 'as' or same if no alias)
            const originalName =
              exportSpecifierDecl.propertyName?.getText() || exportSpecifierDecl.name.getText();
            const exportedName = symbol.name;

            // DEBUG: Log for ContextMenu index.parts.ts
            if (sourceFile.fileName.includes('context-menu/index.parts')) {
              console.warn('[parseExports] ExportSpecifier:', {
                originalName,
                exportedName,
                sourceFile: importedSourceFile.fileName,
              });
              console.warn('[parseExports] parentNamespaceName:', parentNamespaceName);
            }

            // Find or create the reExportInfo for this source file
            let reExportInfo = reExportInfos.find((info) => info.sourceFile === importedSourceFile);
            if (!reExportInfo) {
              reExportInfo = {
                sourceFile: importedSourceFile,
                aliasMap: new Map(),
                // Do NOT inherit parent namespace - it will be added later during namespace processing
              };
              reExportInfos.push(reExportInfo);

              // DEBUG: Log for ContextMenu
              if (sourceFile.fileName.includes('context-menu/index.parts')) {
                console.warn(
                  '[parseExports] Created new reExportInfo for',
                  importedSourceFile.fileName,
                );
              }
            }

            // Store the alias mapping
            reExportInfo.aliasMap.set(originalName, exportedName);

            // DEBUG: Log for ContextMenu
            if (sourceFile.fileName.includes('context-menu/index.parts')) {
              console.warn('[parseExports] Set alias mapping:', originalName, '→', exportedName);
              console.warn('[parseExports] aliasMap size now:', reExportInfo.aliasMap.size);
            }
          }
        }
      } else {
        // When we have an ExportSpecifier without a moduleSpecifier, it could be from:
        // 1. A transformed namespace export (export * as X) compiled to JS
        // 2. A regular export from the same file
        // We need to trace the symbol to find its actual source

        // DEBUG: Log for Toolbar
        if (sourceFile.fileName.includes('toolbar/index.ts')) {
          console.warn('[parseExports] ExportSpecifier without moduleSpecifier:', symbol.name);
          console.warn('[parseExports] Checking for aliased symbol...');
        }

        // Try to find the actual source by looking at the aliased symbol
        const aliasedSymbol = checker.getAliasedSymbol(symbol);

        // DEBUG: Log aliased symbol for Toolbar
        if (sourceFile.fileName.includes('toolbar/index.ts')) {
          console.warn('[parseExports] aliasedSymbol:', aliasedSymbol?.name);
          console.warn('[parseExports] aliasedSymbol === symbol:', aliasedSymbol === symbol);
        }

        if (aliasedSymbol && aliasedSymbol !== symbol) {
          const aliasedDeclarations = aliasedSymbol.declarations;

          // DEBUG: Log declarations for Toolbar
          if (sourceFile.fileName.includes('toolbar/index.ts')) {
            console.warn('[parseExports] aliasedDeclarations:', aliasedDeclarations?.length);
          }

          if (aliasedDeclarations && aliasedDeclarations.length > 0) {
            const aliasedSourceFile = aliasedDeclarations[0].getSourceFile();

            // DEBUG: Log source file for Toolbar
            if (sourceFile.fileName.includes('toolbar/index.ts')) {
              console.warn(
                '[parseExports] Found namespace export! aliasedSourceFile:',
                aliasedSourceFile.fileName,
              );
              console.warn('[parseExports] Setting namespaceName:', symbol.name);
            }

            // This is likely a namespace import that was re-exported
            // We should process the aliased source file
            reExportInfos.push({
              sourceFile: aliasedSourceFile,
              aliasMap: new Map(),
              namespaceName: symbol.name,
            });
          }
        }
      }
    }
  });

  // If there are re-exports, recursively process them
  if (reExportInfos.length > 0) {
    // DEBUG: Log all reExportInfos for Toolbar and ContextMenu
    if (
      sourceFile.fileName.includes('toolbar/index') ||
      sourceFile.fileName.includes('context-menu/index')
    ) {
      console.warn(
        `[parseExports] ${sourceFile.fileName} has ${reExportInfos.length} reExportInfos:`,
      );
      reExportInfos.forEach((info, idx) => {
        console.warn(
          `  [${idx}] sourceFile: ${info.sourceFile.fileName}, namespaceName: ${info.namespaceName}, aliasMap: ${info.aliasMap.size}`,
        );
      });
    }

    // Check if any re-export has a namespace - if so, collect its aliases to share with type exports
    const namespaceReExport = reExportInfos.find((info) => info.namespaceName);
    let sharedAliasMap: Map<string, string> | undefined;
    let filteredReExportInfos = reExportInfos;

    // If we have a namespace export, ONLY process that one and skip type-only re-exports
    // This prevents duplicate processing when we have both `export * as Name` and `export type *`
    if (namespaceReExport) {
      // DEBUG: Log all reExportInfos for toolbar
      if (sourceFile.fileName.includes('toolbar/index.ts')) {
        const logPath = '/tmp/toolbar-typegen-debug.log';
        const logMessage = `[parseExports] Total reExportInfos for index.ts: ${reExportInfos.length}\n`;
        reExportInfos.forEach((info, idx) => {
          appendFileSync(
            logPath,
            `[${idx}] sourceFile: ${info.sourceFile.fileName}, namespaceName: ${info.namespaceName}, aliasMap: ${info.aliasMap.size}\n`,
          );
        });
        appendFileSync(logPath, logMessage);
      }

      sharedAliasMap = new Map();

      // Parse the namespace module's export statements to get aliases
      // e.g., `export { ComponentRoot as Root }` creates ComponentRoot -> Root
      namespaceReExport.sourceFile.statements.forEach((stmt) => {
        if (
          ts.isExportDeclaration(stmt) &&
          stmt.exportClause &&
          ts.isNamedExports(stmt.exportClause)
        ) {
          stmt.exportClause.elements.forEach((element) => {
            const originalName = (element.propertyName || element.name).text;
            const exportedName = element.name.text;
            sharedAliasMap!.set(originalName, exportedName);
          });
        }
      });

      // Filter to ONLY the namespace export - skip any direct type-only re-exports
      // that are already included in the namespace export's recursive processing
      filteredReExportInfos = [namespaceReExport];

      // DEBUG: Log filtering for ContextMenu
      if (sourceFile.fileName.includes('context-menu/index')) {
        console.warn(
          `[parseExports] Filtered reExportInfos from ${reExportInfos.length} to ${filteredReExportInfos.length} (keeping only namespace export)`,
        );
      }
    }

    for (const reExportInfo of filteredReExportInfos) {
      const recursiveResults = parseExports(
        reExportInfo.sourceFile,
        checker,
        program,
        parserOptions,
        visited,
        reExportInfo.namespaceName, // Pass namespace context to child calls
      );

      // DEBUG: Log which path we're taking
      if (sourceFile.fileName.includes('toolbar')) {
        console.warn('[parseExports] Re-export path for', sourceFile.fileName);
        console.warn('[parseExports] Has namespaceName:', reExportInfo.namespaceName);
        console.warn('[parseExports] Has aliasMap:', reExportInfo.aliasMap.size);
      }

      if (reExportInfo.namespaceName) {
        // For namespace exports, collect all exports from all recursive results
        // and prefix them with the namespace name
        // e.g., ButtonRootProps becomes Button.Root.Props in the Button namespace
        const allNamespaceExports: ExportNode[] = [];

        // Use the reExportInfo's aliasMap if it has one, otherwise use the shared alias map
        const aliasMap = reExportInfo.aliasMap.size > 0 ? reExportInfo.aliasMap : sharedAliasMap;

        // DEBUG: Log recursiveResults for ContextMenu
        if (reExportInfo.namespaceName === 'ContextMenu') {
          console.warn('[parseExports-namespace] Processing namespace: ContextMenu');
          console.warn('[parseExports-namespace] recursiveResults count:', recursiveResults.length);
          recursiveResults.forEach((result, idx) => {
            console.warn(`[parseExports-namespace] recursiveResults[${idx}]:`, {
              name: result.name,
              exportsCount: result.exports.length,
              typeNameMapSize: result.typeNameMap?.size || 0,
            });
            if (result.typeNameMap && result.typeNameMap.size > 0) {
              const entries = Array.from(result.typeNameMap.entries()).slice(0, 3);
              entries.forEach(([flatName, dottedName]) => {
                console.warn(
                  `[parseExports-namespace]   typeNameMap entry: ${flatName} → ${dottedName}`,
                );
              });
            }
          });
        }

        for (const recursiveResult of recursiveResults) {
          for (const exportNode of recursiveResult.exports) {
            // Store the original name before any transformations for DataAttributes/CssVars lookup
            // This is especially important for re-exported components (e.g., MenuBackdrop -> ContextMenu.Backdrop)
            // where the DataAttributes file uses the original name (MenuBackdropDataAttributes)
            if (!(exportNode as any).originalName) {
              (exportNode as any).originalName = exportNode.name;
            }

            // Extract the base component name and suffix from the export name
            // e.g., "ButtonRootProps" -> base: "ButtonRoot", suffix: "Props"
            // We need to transform this to "Button.Root.Props" where:
            // - "Button" is the namespace name from reExportInfo
            // - "Root" comes from the alias map (ButtonRoot -> Root)
            // - "Props" is the suffix

            const namespaceName = reExportInfo.namespaceName;
            const exportName = exportNode.name;

            // Try to find a matching component name in the alias map
            // e.g., "ButtonRootProps" -> find "ButtonRoot" -> get alias "Root" -> suffix "Props"
            let transformedName = exportName;

            // Check each alias to see if the export name starts with the original component name
            if (aliasMap && aliasMap.size > 0) {
              aliasMap.forEach((aliasedName, originalName) => {
                if (transformedName === exportName && exportNode.name.startsWith(originalName)) {
                  // Found a match - split the name into component and suffix
                  const suffix = exportName.slice(originalName.length);

                  // Build the transformed name: Namespace.Alias.Suffix
                  // e.g., "Button" + "Root" + "Props" = "Button.Root.Props"
                  if (suffix) {
                    transformedName = `${namespaceName}.${aliasedName}.${suffix}`;
                  } else {
                    // No suffix - just the component name
                    transformedName = `${namespaceName}.${aliasedName}`;
                  }
                }
              });
            }

            // If no alias match found, add namespace prefix
            // The originalName (stored above) preserves the name before any aliasing,
            // so we can use it directly for lookups later
            if (transformedName === exportName) {
              // DEBUG: Check for double dots BEFORE transformation
              if (exportName.includes('Separator') && exportName.includes('..')) {
                console.warn('[parseExports] DOUBLE DOT BEFORE TRANSFORM:', {
                  exportName,
                  namespaceName,
                  'exportNode.name': exportNode.name,
                });
              }

              if (exportName.startsWith(namespaceName)) {
                // Export already starts with namespace (e.g., "AutocompleteRootProps")
                // Remove namespace prefix and re-add with dots
                const withoutNamespace = exportName.slice(namespaceName.length);
                if (withoutNamespace) {
                  transformedName = `${namespaceName}.${withoutNamespace}`;
                }
              } else if (exportName.includes('.')) {
                // Export is already dotted (e.g., "Separator.Props" from namespace member)
                // Just prepend the namespace

                // DEBUG: Check what's being concatenated
                if (exportName.includes('Separator')) {
                  console.warn('[parseExports] Adding namespace prefix to dotted export:', {
                    exportName,
                    namespaceName,
                    result: `${namespaceName}.${exportName}`,
                  });
                }

                transformedName = `${namespaceName}.${exportName}`;
              } else {
                // Export is a flat name - just add namespace prefix
                transformedName = `${namespaceName}.${exportName}`;
              }
            }

            exportNode.name = transformedName;
            allNamespaceExports.push(exportNode);
          }
        }

        // Merge typeNameMaps from all component files and transform with namespace prefix
        const mergedTypeNameMap = new Map<string, string>();
        const namespace = reExportInfo.namespaceName;

        // DEBUG: Log namespace for Toolbar and ContextMenu
        if (namespace === 'Toolbar' || namespace === 'ContextMenu') {
          const logPath =
            namespace === 'Toolbar'
              ? '/tmp/toolbar-typegen-debug.log'
              : '/tmp/contextmenu-typegen-debug.log';
          const logMessage =
            `[parseExports] Processing namespace: ${namespace}\n` +
            `[parseExports] recursiveResults count: ${recursiveResults.length}\n`;
          appendFileSync(logPath, logMessage);
          console.warn('[parseExports] Processing namespace:', namespace);
          console.warn('[parseExports] recursiveResults count:', recursiveResults.length);
          recursiveResults.forEach((result, idx) => {
            const hasMap = result.typeNameMap ? 'has typeNameMap' : 'NO typeNameMap';
            const mapSize = result.typeNameMap?.size || 0;
            const msg = `[parseExports] recursiveResults[${idx}]: ${hasMap}, size=${mapSize}, name=${result.name}\n`;
            appendFileSync(logPath, msg);
            console.warn(msg.trim());

            // For ContextMenu, also log the actual typeNameMap entries
            if (namespace === 'ContextMenu' && result.typeNameMap) {
              Array.from(result.typeNameMap.entries()).forEach(([key, value]) => {
                const entryMsg = `[parseExports]   typeNameMap entry: ${key} → ${value}\n`;
                appendFileSync(logPath, entryMsg);
                console.warn(entryMsg.trim());
              });
            }
          });
        }

        for (const result of recursiveResults) {
          if (result.typeNameMap) {
            Array.from(result.typeNameMap.entries()).forEach(([flatName, dottedName]) => {
              // DEBUG: Log transformation for ContextMenuRoot
              if (namespace === 'ContextMenu' && flatName.includes('ContextMenuRoot')) {
                console.warn('[parseExports-namespace] Processing ContextMenuRoot entry:', {
                  flatName,
                  dottedName,
                  namespace,
                });
              }

              // DEBUG: Log transformation for Toolbar or ContextMenu
              if (
                (namespace === 'Toolbar' &&
                  (flatName.includes('Orientation') || flatName.includes('ToolbarRoot'))) ||
                (namespace === 'ContextMenu' &&
                  (flatName.includes('MenuRoot') || flatName.includes('MenuBackdrop')))
              ) {
                const logPath =
                  namespace === 'Toolbar'
                    ? '/tmp/toolbar-typegen-debug.log'
                    : '/tmp/contextmenu-typegen-debug.log';
                const logMessage = `[parseExports] Before transformation: ${JSON.stringify({ flatName, dottedName, namespace })}\n`;
                appendFileSync(logPath, logMessage);
                console.warn('[parseExports] Before transformation:', {
                  flatName,
                  dottedName,
                  namespace,
                });
              }

              // Transform the dotted name to replace source namespace with target namespace
              // E.g., when ContextMenu re-exports from Menu:
              //   "Menu.Backdrop.State" -> "ContextMenu.Backdrop.State"
              // OR when ContextMenu re-exports MenuBackdrop as Backdrop:
              //   "MenuBackdrop.State" -> "Backdrop.State" -> "ContextMenu.Backdrop.State"
              const parts = dottedName.split('.');
              const componentPart = parts[0]; // e.g., "Menu", "MenuBackdrop", or "ToolbarRoot"
              let transformedComponentPart = componentPart;

              // Apply alias transformations to the component part ONLY
              // This handles: MenuBackdrop -> Backdrop, ToolbarRoot -> Root, etc.
              if (aliasMap) {
                aliasMap.forEach((aliasedName, originalName) => {
                  // Match exact component name OR component name with suffix (MenuRadioItem matches Menu)
                  if (componentPart === originalName) {
                    // Exact match: MenuBackdrop -> Backdrop
                    transformedComponentPart = aliasedName;
                  } else if (componentPart.startsWith(originalName)) {
                    // Prefix match with suffix: MenuRadioItem matches Menu, keep suffix RadioItem
                    const suffix = componentPart.slice(originalName.length);
                    transformedComponentPart = suffix ? `${aliasedName}${suffix}` : aliasedName;
                  }
                });
              }

              // Replace the first part (component name) with the transformed name
              // Then prepend the namespace
              parts[0] = transformedComponentPart;
              const transformedDottedName = `${namespace}.${parts.join('.')}`;

              // DEBUG: Log transformation for Toolbar or ContextMenu
              if (
                (namespace === 'Toolbar' &&
                  (flatName.includes('Orientation') || flatName.includes('ToolbarRoot'))) ||
                (namespace === 'ContextMenu' &&
                  (flatName.includes('MenuRoot') || flatName.includes('MenuBackdrop')))
              ) {
                const logPath =
                  namespace === 'Toolbar'
                    ? '/tmp/toolbar-typegen-debug.log'
                    : '/tmp/contextmenu-typegen-debug.log';
                const logMessage = `[parseExports] After transformation: ${JSON.stringify({ flatName, transformedDottedName, componentPart, transformedComponentPart })}\n`;
                appendFileSync(logPath, logMessage);
                console.warn('[parseExports] After transformation:', {
                  flatName,
                  transformedDottedName,
                  componentPart,
                  transformedComponentPart,
                });
              }

              // Set the main mapping: flatName -> transformedDottedName
              mergedTypeNameMap.set(flatName, transformedDottedName);
            });
          }
        }

        // Collect all source file paths from the re-export results for adjacent file discovery
        const sourceFilePaths = recursiveResults
          .flatMap((result) => result.sourceFilePaths || [])
          .concat([reExportInfo.sourceFile.fileName]);

        allResults.push({
          name: reExportInfo.namespaceName,
          exports: allNamespaceExports,
          typeNameMap: mergedTypeNameMap,
          sourceFilePaths,
        });
      } else {
        // Process each recursive result for regular re-exports
        for (const recursiveResult of recursiveResults) {
          // Use the reExportInfo's aliasMap if it has one, otherwise use the shared alias map
          const aliasMap = reExportInfo.aliasMap.size > 0 ? reExportInfo.aliasMap : sharedAliasMap;

          if (aliasMap && aliasMap.size > 0) {
            // Apply alias mappings to individual exports
            // Include both explicitly aliased exports AND related types that share the same prefix
            const aliasedExports: ExportNode[] = [];

            // Sort original names by length (longest first) for prefix matching
            const sortedOriginalNames = Array.from(aliasMap.keys()).sort(
              (a, b) => b.length - a.length,
            );

            for (const exportNode of recursiveResult.exports) {
              // Store the original name before any transformations for DataAttributes/CssVars lookup
              // This is especially important for re-exported components (e.g., MenuBackdrop -> ContextMenu.Backdrop)
              // where the DataAttributes file uses the original name (MenuBackdropDataAttributes)
              if (!(exportNode as any).originalName) {
                (exportNode as any).originalName = exportNode.name;
              }

              if (aliasMap.has(exportNode.name)) {
                // This export is explicitly aliased (e.g., AccordionRoot -> Root)
                const aliasedName = aliasMap.get(exportNode.name)!;
                exportNode.name = aliasedName;
                aliasedExports.push(exportNode);
              } else {
                // Check if this export starts with any aliased component name
                // e.g., "AccordionRootState" starts with "AccordionRoot" which is aliased to "Root"
                for (const originalName of sortedOriginalNames) {
                  if (
                    exportNode.name.startsWith(originalName) &&
                    exportNode.name !== originalName
                  ) {
                    const aliasedName = aliasMap.get(originalName)!;
                    const suffix = exportNode.name.slice(originalName.length);

                    // Rename: "AccordionRootState" -> "Root.State"
                    // Handle namespace members that already have a leading dot (e.g., ".Props")
                    if (suffix.startsWith('.')) {
                      exportNode.name = `${aliasedName}${suffix}`;
                    } else {
                      exportNode.name = `${aliasedName}.${suffix}`;
                    }

                    aliasedExports.push(exportNode);
                    break;
                  }
                }
              }
            }

            // Transform typeNameMap for aliased exports
            const transformedTypeNameMap = new Map<string, string>();
            if (recursiveResult.typeNameMap) {
              // DEBUG: Log typeNameMap transformation for Toolbar
              if (reExportInfo.sourceFile.fileName.includes('toolbar')) {
                const logPath = '/tmp/toolbar-typegen-debug.log';
                const logMessage =
                  `[parseExports-regular] Processing aliased re-export for ${reExportInfo.sourceFile.fileName}\n` +
                  `[parseExports-regular] recursiveResult.typeNameMap size: ${recursiveResult.typeNameMap.size}\n` +
                  `[parseExports-regular] aliasMap size: ${aliasMap.size}\n` +
                  `[parseExports-regular] aliasMap entries: ${JSON.stringify(Array.from(aliasMap.entries()))}\n`;
                appendFileSync(logPath, logMessage);
              }

              recursiveResult.typeNameMap.forEach((dottedName, flatName) => {
                let transformedName = dottedName;

                // DEBUG: Log transformation for Toolbar types OR MenuBackdrop
                if (
                  (reExportInfo.sourceFile.fileName.includes('toolbar') &&
                    (flatName.includes('Orientation') || flatName.includes('ToolbarRoot'))) ||
                  flatName.includes('MenuBackdrop')
                ) {
                  const logPath = reExportInfo.sourceFile.fileName.includes('toolbar')
                    ? '/tmp/toolbar-typegen-debug.log'
                    : '/tmp/contextmenu-typegen-debug.log';
                  const logMessage = `[parseExports-regular] Transforming: ${flatName} → ${dottedName} (from ${reExportInfo.sourceFile.fileName})\n`;
                  appendFileSync(logPath, logMessage);
                  console.warn(
                    `[parseExports-regular] Transforming: ${flatName} → ${dottedName} (from ${reExportInfo.sourceFile.fileName})`,
                  );
                }

                // Apply alias transformations to the FIRST PART ONLY (component name)
                // E.g., MenuBackdrop.State → Backdrop.State (when MenuBackdrop -> Backdrop)
                // Do NOT add any namespace prefix here - that's handled by namespace export processing
                aliasMap.forEach((aliasedName, originalName) => {
                  const parts = dottedName.split('.');
                  const componentPart = parts[0];

                  if (componentPart === originalName || componentPart.startsWith(originalName)) {
                    const suffix = componentPart.slice(originalName.length);
                    parts[0] = suffix ? `${aliasedName}${suffix}` : aliasedName;
                    transformedName = parts.join('.');
                  }
                });

                // DEBUG: Log final transformation for Toolbar types OR MenuBackdrop OR ContextMenuRoot
                if (
                  (reExportInfo.sourceFile.fileName.includes('toolbar') &&
                    (flatName.includes('Orientation') || flatName.includes('ToolbarRoot'))) ||
                  flatName.includes('MenuBackdrop') ||
                  flatName.includes('ContextMenuRoot')
                ) {
                  const logPath = reExportInfo.sourceFile.fileName.includes('toolbar')
                    ? '/tmp/toolbar-typegen-debug.log'
                    : '/tmp/contextmenu-typegen-debug.log';
                  const logMessage = `[parseExports-regular] Final transformed: ${flatName} → ${transformedName}\n`;
                  appendFileSync(logPath, logMessage);
                  console.warn(
                    `[parseExports-regular] Final transformed: ${flatName} → ${transformedName}`,
                  );
                }

                transformedTypeNameMap.set(flatName, transformedName);
              });
            }

            // Collect source file paths from recursive result
            const sourceFilePaths = (recursiveResult.sourceFilePaths || []).concat([
              reExportInfo.sourceFile.fileName,
            ]);

            allResults.push({
              name: recursiveResult.name,
              exports: aliasedExports,
              typeNameMap: transformedTypeNameMap,
              sourceFilePaths,
            });

            // DEBUG: Log when adding results from ContextMenuRoot
            if (reExportInfo.sourceFile.fileName.includes('ContextMenuRoot')) {
              console.warn(
                '[parseExports-regular] Added result for ContextMenuRoot, typeNameMap size:',
                transformedTypeNameMap.size,
              );
              const entries = Array.from(transformedTypeNameMap.entries());
              entries.forEach(([flatName, dottedName]) => {
                console.warn(`[parseExports-regular]   ${flatName} → ${dottedName}`);
              });
            }
          } else {
            // No alias, use the original result
            allResults.push(recursiveResult);
          }
        }
      }
    }
  } else {
    // No re-exports found, parse actual exports from this file
    const { exports } = parseFromProgram(fileName, program, parserOptions);

    // Extract namespace members (e.g., Component.State, Component.Props)
    const namespaceMembers = extractNamespaceMembers(sourceFile);

    // WORKAROUND: typescript-api-extractor doesn't find `export type` declarations
    // Manually extract them from the source file AST
    const manualTypeExports: ExportNode[] = [];
    sourceFile.statements.forEach((statement) => {
      if (
        ts.isTypeAliasDeclaration(statement) &&
        statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        const typeName = statement.name.text;
        // Check if this type is already in exports
        if (!exports.find((exp) => exp.name === typeName)) {
          // Parse this type using parseFromProgram with specific include
          const typeParserOptions: ParserOptions = {
            ...parserOptions,
            shouldInclude: ({ name }) =>
              name === typeName || parserOptions.shouldInclude?.({ name, depth: 0 }),
          };
          const { exports: typeExports } = parseFromProgram(fileName, program, typeParserOptions);
          const foundType = typeExports.find((exp) => exp.name === typeName);
          if (foundType) {
            manualTypeExports.push(foundType);
          }
        }
      }
    });

    // Merge manual exports with parsed exports
    const allExports = [...exports, ...manualTypeExports];

    // Build typeNameMap from namespace members
    // For each namespace (e.g., "MenuRadioItem"), add entries for its members
    // E.g., "MenuRadioItemState" -> "Menu.RadioItem.State" (will be transformed later with namespace prefix)
    const typeNameMap = new Map<string, string>();

    // DEBUG: Log namespace members for Toolbar-related files
    if (
      sourceFile.fileName.includes('toolbar') ||
      sourceFile.fileName.includes('MenuBackdrop') ||
      sourceFile.fileName.includes('MenuRoot')
    ) {
      console.warn(
        '[parseExports] Building typeNameMap from namespaceMembers:',
        namespaceMembers.size,
      );
      console.warn('[parseExports] sourceFile:', sourceFile.fileName);
      console.warn(
        '[parseExports] Namespace members entries:',
        Array.from(namespaceMembers.entries()).map(([name, members]) => [
          name,
          Array.from(members.entries()),
        ]),
      );
    }

    // Also build a reverse map: memberName -> componentName for namespace member detection
    const memberToComponentMap = new Map<string, string>();

    Array.from(namespaceMembers.entries()).forEach(([componentName, members]) => {
      Array.from(members.entries()).forEach(([memberName, flatTypeName]) => {
        // DEBUG: Log entry creation for MenuBackdrop and MenuRoot
        if (
          sourceFile.fileName.includes('MenuBackdrop') ||
          sourceFile.fileName.includes('MenuRoot') ||
          componentName.includes('Separator')
        ) {
          console.warn('[parseExports] Creating typeNameMap entry:', {
            flatTypeName,
            componentName,
            memberName,
            mappedValue: `${componentName}.${memberName}`,
          });
        }

        // The flat name is like "MenuRadioItemState"
        // For now just map it to "ComponentName.MemberName", namespace prefix added later
        typeNameMap.set(flatTypeName, `${componentName}.${memberName}`);

        // Track which member names belong to which component
        if (componentName.includes('Separator') || memberName.includes('Separator')) {
          console.warn('[parseExports] Setting memberToComponentMap:', {
            memberName,
            componentName,
            fileName: sourceFile.fileName,
          });
        }
        memberToComponentMap.set(memberName, componentName);
      });

      // ALSO add the component name itself to the map (e.g., MenuRadioItem → Menu.RadioItem)
      // This is needed for references like "MenuRadioItem.State" where MenuRadioItem needs transformation
      // The namespace prefix will be added later during re-export processing
      if (members.size > 0) {
        typeNameMap.set(componentName, componentName);
      }
    });

    // Apply typeNameMap transformations to flat exports
    // This converts exports like "ToggleState" -> "Toggle.State"
    const transformedExports = allExports.map((exp) => {
      const dottedName = typeNameMap.get(exp.name);
      if (dottedName) {
        // This export is a namespace member, replace with dotted name
        const transformedExport = Object.assign(Object.create(Object.getPrototypeOf(exp)), exp, {
          name: dottedName,
        });
        return transformedExport;
      }
      return exp;
    });

    // Process exports to detect namespace members (indicated by leading dot)
    // and store this information as metadata
    const processedExports = transformedExports.map((exp) => {
      if (exp.name.startsWith('.')) {
        // This is a namespace member - store the flag and prefix with component name
        const memberName = exp.name.slice(1); // Remove leading dot
        const componentName = memberToComponentMap.get(memberName);

        // Build the full name: Component.Member (e.g., "Toggle.Props")
        const fullName = componentName ? `${componentName}.${memberName}` : memberName;

        const processedExport: ExportNode & { isNamespaceMember: boolean } = Object.assign(
          Object.create(Object.getPrototypeOf(exp)),
          exp,
          { name: fullName, isNamespaceMember: true },
        );
        return processedExport;
      }
      return exp;
    });

    allResults.push({
      name: '',
      exports: processedExports,
      typeNameMap,
      sourceFilePaths: [sourceFile.fileName],
    });
  }

  return allResults;
}
