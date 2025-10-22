import ts from 'typescript';
import type { Program, SourceFile, TypeChecker } from 'typescript';
import { parseFromProgram, type ExportNode, type ParserOptions } from 'typescript-api-extractor';

type ReExportInfo = {
  sourceFile: SourceFile;
  aliasMap: Map<string, string>; // Maps original name -> exported name
  namespaceName?: string; // For `export * as X`
};

export type ParsedReExports = {
  name: string;
  exports: ExportNode[];
};

export function parseExports(
  sourceFile: SourceFile,
  checker: TypeChecker,
  program: Program,
  parserOptions: ParserOptions,
  visited: Set<string> = new Set(),
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
      const exportDecl = namespaceExportDecl.parent;

      if (ts.isExportDeclaration(exportDecl) && exportDecl.moduleSpecifier) {
        const moduleSpecifier = exportDecl.moduleSpecifier;

        if (ts.isStringLiteral(moduleSpecifier)) {
          // Get the source file of the module being re-exported
          const importedSymbol = checker.getSymbolAtLocation(moduleSpecifier);
          const importedSourceFile = importedSymbol?.valueDeclaration?.getSourceFile();

          if (importedSourceFile) {
            const namespaceName = symbol.name;

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

            // Find or create the reExportInfo for this source file
            let reExportInfo = reExportInfos.find((info) => info.sourceFile === importedSourceFile);
            if (!reExportInfo) {
              reExportInfo = {
                sourceFile: importedSourceFile,
                aliasMap: new Map(),
              };
              reExportInfos.push(reExportInfo);
            }

            // Store the alias mapping
            reExportInfo.aliasMap.set(originalName, exportedName);
          }
        }
      } else {
        // When we have an ExportSpecifier without a moduleSpecifier, it could be from:
        // 1. A transformed namespace export (export * as X) compiled to JS
        // 2. A regular export from the same file
        // We need to trace the symbol to find its actual source

        // Try to find the actual source by looking at the aliased symbol
        const aliasedSymbol = checker.getAliasedSymbol(symbol);
        if (aliasedSymbol && aliasedSymbol !== symbol) {
          const aliasedDeclarations = aliasedSymbol.declarations;
          if (aliasedDeclarations && aliasedDeclarations.length > 0) {
            const aliasedSourceFile = aliasedDeclarations[0].getSourceFile();

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
    // Check if any re-export has a namespace - if so, collect its aliases to share with type exports
    const namespaceReExport = reExportInfos.find((info) => info.namespaceName);
    let sharedAliasMap: Map<string, string> | undefined;

    // If we have a namespace export, build a shared alias map from its source file
    if (namespaceReExport) {
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
    }

    for (const reExportInfo of reExportInfos) {
      const recursiveResults = parseExports(
        reExportInfo.sourceFile,
        checker,
        program,
        parserOptions,
        visited,
      );

      if (reExportInfo.namespaceName) {
        // For namespace exports, collect all exports from all recursive results
        // and prefix them with the namespace name
        // e.g., ButtonRootProps becomes Button.Root.Props in the Button namespace
        const allNamespaceExports: ExportNode[] = [];

        // Use the reExportInfo's aliasMap if it has one, otherwise use the shared alias map
        const aliasMap = reExportInfo.aliasMap.size > 0 ? reExportInfo.aliasMap : sharedAliasMap;

        for (const recursiveResult of recursiveResults) {
          for (const exportNode of recursiveResult.exports) {
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
                if (transformedName === exportName && exportName.startsWith(originalName)) {
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

            // If no alias match found, fall back to simple prefix removal
            // (for exports that don't follow the component naming pattern)
            if (transformedName === exportName && exportName.startsWith(namespaceName)) {
              const withoutNamespace = exportName.slice(namespaceName.length);
              // Only add the dot if there's actually a suffix after the namespace
              if (withoutNamespace) {
                transformedName = `${namespaceName}.${withoutNamespace}`;
              }
              // If withoutNamespace is empty, the export name is the same as namespace name,
              // so keep it as-is (transformedName = exportName)
            }

            exportNode.name = transformedName;
            allNamespaceExports.push(exportNode);
          }
        }

        allResults.push({
          name: reExportInfo.namespaceName,
          exports: allNamespaceExports,
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
                    exportNode.name = `${aliasedName}.${suffix}`;
                    aliasedExports.push(exportNode);
                    break;
                  }
                }
              }
            }
            allResults.push({
              name: recursiveResult.name,
              exports: aliasedExports,
            });
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
    allResults.push({
      name: '',
      exports,
    });
  }

  return allResults;
}
