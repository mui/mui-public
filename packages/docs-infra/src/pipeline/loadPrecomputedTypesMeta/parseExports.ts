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
        // and group them under a single namespace name
        const allNamespaceExports: ExportNode[] = [];
        for (const recursiveResult of recursiveResults) {
          allNamespaceExports.push(...recursiveResult.exports);
        }

        allResults.push({
          name: reExportInfo.namespaceName,
          exports: allNamespaceExports,
        });
      } else {
        // Process each recursive result for regular re-exports
        for (const recursiveResult of recursiveResults) {
          if (reExportInfo.aliasMap.size > 0) {
            // Apply alias mappings to individual exports by mutating the name property
            // Only include exports that are explicitly re-exported (in the aliasMap)
            const aliasedExports: ExportNode[] = [];
            for (const exportNode of recursiveResult.exports) {
              if (reExportInfo.aliasMap.has(exportNode.name)) {
                // Mutate the name property directly to preserve methods like isPublic()
                const aliasedName = reExportInfo.aliasMap.get(exportNode.name)!;
                exportNode.name = aliasedName;
                aliasedExports.push(exportNode);
              }
              // If not in aliasMap, skip this export (don't include it)
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
